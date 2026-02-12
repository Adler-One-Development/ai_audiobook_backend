import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8083;

// Simple deep equal helper
function deepComparison(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== "object" || obj1 === null || typeof obj2 !== "object" || obj2 === null) return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
        if (!keys2.includes(key) || !deepComparison(obj1[key], obj2[key])) return false;
    }
    return true;
}

// =============================================================================
// HTTP SERVER WITH WEBSOCKET SUPPORT
// =============================================================================
const server = http.createServer((req, res) => {
    // Health check endpoint for Cloud Run
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'Chapter Audio Generation WebSocket Server',
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchChapterAudioLog(projectId, studioId, chapterId, accessToken, supabaseUrl) {
    try {
        const url = `${supabaseUrl}/functions/v1/getChapterAudioLog?project_id=${projectId}&studio_id=${studioId}&chapter_id=${chapterId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`fetchChapterAudioLog failed: ${response.status}`);
            return null;
        }

        const data = await response.json();
        // data: { status: "success", exists: boolean, chapter_snapshot: ... }
        if (data && data.exists) {
            return data.chapter_snapshot;
        }
        return null;
    } catch (error) {
        console.error("fetchChapterAudioLog error:", error);
        return null; // Return null on error so we default to generating
    }
}

async function saveChapterAudioLog(projectId, studioId, chapterId, chapterSnapshot, accessToken, supabaseUrl) {
    try {
        const url = `${supabaseUrl}/functions/v1/saveChapterAudioLog`;
        const formData = new FormData();
        formData.append('project_id', projectId);
        formData.append('studio_id', studioId);
        formData.append('chapter_id', chapterId);
        formData.append('chapter_snapshot', JSON.stringify(chapterSnapshot));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`saveChapterAudioLog failed: ${response.status} - ${text}`);
        } else {
             console.log("Chapter audio log saved successfully.");
        }
    } catch (error) {
        console.error("saveChapterAudioLog error:", error);
    }
}

async function checkFileExists(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch (error) {
        console.error("checkFileExists error:", error);
        return false;
    }
}

async function fetchChapterContent(projectId, chapterId, accessToken, supabaseUrl) {
    try {
        const url = `${supabaseUrl}/functions/v1/getAllChapters?projectId=${projectId}&chapterId=${chapterId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.error(`fetchChapterContent failed: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        if (data.chapters && data.chapters.length > 0) {
            const chapter = data.chapters[0]; // Assuming filtered by chapterId
            
            // Fetch project to get studio_id if not in chapter (it usually isn't in simple chapter obj)
            // But wait, chapter object from getAllChapters might NOT have studio_id on root.
            // We need studio_id for the log and storage path.
            
            let studioId = null;
             const projectUrl = `${supabaseUrl}/functions/v1/getProjectById?id=${projectId}`;
             const projectResp = await fetch(projectUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
             });

             if (projectResp.ok) {
                 const pData = await projectResp.json();
                 studioId = pData.project?.studio_id;
             } else {
                 console.error("Project fetch failed");
             }

            // Clean comments from blocks
            if (chapter.content && chapter.content.blocks) {
                chapter.content.blocks = chapter.content.blocks.map(block => {
                    if (block.comments) {
                        const { comments: _comments, ...rest } = block;
                        return rest;
                    }
                    return block;
                });
            }

            return { ...chapter, studioId };
        }
        return null;
    } catch (err) {
        console.error("fetchChapterContent error:", err);
        return null;
    }
}

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================
const wss = new WebSocketServer({ server });

console.log(`WebSocket server starting on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', JSON.stringify(data).substring(0, 200));

            const {
                project_id,
                chapter_id,
                access_token,
                eleven_labs_api_key
            } = data;

            // Validate required fields
            if (!project_id || !chapter_id || !access_token || !eleven_labs_api_key) {
                ws.send(JSON.stringify({ 
                    status: 'error', 
                    message: 'Missing required fields: project_id, chapter_id, access_token, eleven_labs_api_key' 
                }));
                return;
            }

            // Start Processing
            await processChapterAudioGeneration(ws, project_id, chapter_id, access_token, eleven_labs_api_key);

        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ status: 'error', message: `Server error: ${error.message}` }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

async function processChapterAudioGeneration(ws, projectId, chapterId, accessToken, elevenLabsApiKey) {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co';

    try {
        // 1. Fetch current chapter content
        ws.send(JSON.stringify({ status: 'fetching_content', message: 'Fetching chapter content...' }));
        
        const currentChapterContent = await fetchChapterContent(projectId, chapterId, accessToken, SUPABASE_URL);
        
        if (!currentChapterContent) {
             throw new Error("Failed to fetch chapter content or chapter not found");
        }

        const studioId = currentChapterContent.studioId;
        if (!studioId) {
             throw new Error("Could not determine studio_id from chapter fetch");
        }

        // Clean snapshot for comparison/saving
        const cleanChapterSnapshot = { ...currentChapterContent };
        delete cleanChapterSnapshot.studioId;

        // 2. Retrieve last snapshot from logs
        ws.send(JSON.stringify({ status: 'checking_cache', message: 'Checking audio logs...' }));
        const lastSnapshot = await fetchChapterAudioLog(projectId, studioId, chapterId, accessToken, SUPABASE_URL);

        // 3. Check if file exists in storage
        const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/audio_files/${studioId}/chapters/${chapterId}.txt`;
        const fileExists = await checkFileExists(fileUrl);

        // 4. Compare
        const isChanged = !deepComparison(cleanChapterSnapshot, lastSnapshot);
        console.log(`State Check - Changed: ${isChanged}, Exists: ${fileExists}`);

        // Logic: If file exists AND content hasn't changed -> Return existing
        if (fileExists && !isChanged) {
             console.log("No changes and file exists. Returning existing URL:", fileUrl);
             
             ws.send(JSON.stringify({ 
                status: 'complete', 
                message: 'Content unchanged, audio exists.', 
                data: {
                    file_id: "", 
                    url: fileUrl,
                    chapter_id: chapterId,
                    cached: true
                } 
            }));
            return;
        }

        // 5. Convert Chapter (if generating new)
        ws.send(JSON.stringify({ status: 'converting', message: 'Starting chapter conversion...' }));
        
        const convertUrl = `${SUPABASE_URL}/functions/v1/convertChapter`;
        const startTimeUnix = Math.floor(Date.now() / 1000); // Current time in Unix timestamp

        const convertFormData = new FormData();
        convertFormData.append('projectId', projectId);
        convertFormData.append('chapterId', chapterId);

        const convertResponse = await fetch(convertUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'eleven-labs-api-key': elevenLabsApiKey
            },
            body: convertFormData
        });

        if (!convertResponse.ok) {
            const errorText = await convertResponse.text();
            throw new Error(`Convert failed: ${convertResponse.status} - ${errorText}`);
        }

        ws.send(JSON.stringify({ 
            status: 'waiting_for_snapshot', 
            message: 'Conversion initiated. Waiting for snapshot to be created...' 
        }));

        // 6. Poll for new snapshot
        let chapterSnapshotId = null;
        const maxRetries = 20; // 20 attempts
        const pollInterval = 3000; // 3 seconds

        for (let i = 0; i < maxRetries; i++) {
            const snapshotsUrl = `${SUPABASE_URL}/functions/v1/getChapterSnapshots?project_id=${projectId}&chapter_id=${chapterId}`;
            
            try {
                const snapshotsResponse = await fetch(snapshotsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'eleven-labs-api-key': elevenLabsApiKey
                    }
                });

                if (snapshotsResponse.ok) {
                    const snapshotsData = await snapshotsResponse.json();
                    const snapshots = snapshotsData.snapshots || [];

                    // Find a snapshot created AFTER we started the conversion
                    const newSnapshot = snapshots.find(s => s.created_at_unix >= startTimeUnix);
                    
                    if (newSnapshot) {
                        chapterSnapshotId = newSnapshot.chapter_snapshot_id;
                        console.log(`Found new snapshot: ${chapterSnapshotId} (created: ${newSnapshot.created_at_unix})`);
                        break;
                    }
                } else {
                    console.warn(`Polling snapshots failed: ${snapshotsResponse.status}`);
                }
            } catch (err) {
                console.warn('Polling error:', err);
            }

            console.log(`Waiting for snapshot... attempt ${i + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        if (!chapterSnapshotId) {
            throw new Error('Timeout: Failed to obtain new chapter snapshot ID after conversion.');
        }

        ws.send(JSON.stringify({ 
            status: 'snapshot_created', 
            message: 'Chapter converted and snapshot verified', 
            snapshot_id: chapterSnapshotId 
        }));

        // 7. Generate Audio
        ws.send(JSON.stringify({ status: 'generating_audio', message: 'Generating audio...' }));

        const generateUrl = `${SUPABASE_URL}/functions/v1/generateAudioForChapter`;
        
        const generateFormData = new FormData();
        generateFormData.append('projectId', projectId);
        generateFormData.append('chapterId', chapterId);
        generateFormData.append('chapterSnapshotId', chapterSnapshotId);

        const generateResponse = await fetch(generateUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'eleven-labs-api-key': elevenLabsApiKey
            },
            body: generateFormData
        });

        if (!generateResponse.ok) {
            const errorText = await generateResponse.text();
            throw new Error(`Audio generation failed: ${generateResponse.status} - ${errorText}`);
        }

        const generateData = await generateResponse.json();

        // 8. Save Log
        await saveChapterAudioLog(projectId, studioId, chapterId, cleanChapterSnapshot, accessToken, SUPABASE_URL);

        // 9. Complete
        ws.send(JSON.stringify({ 
            status: 'complete', 
            message: 'Audio generation completed', 
            data: generateData 
        }));

    } catch (error) {
        console.error('Process error:', error);
        ws.send(JSON.stringify({ 
            status: 'error', 
            message: `Process failed: ${error.message}` 
        }));
    }
}

server.listen(PORT, () => {
    console.log(`Chapter Audio Generation Server running on port ${PORT}`);
});
