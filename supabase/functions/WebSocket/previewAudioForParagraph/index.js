import { WebSocketServer } from 'ws';
import process from "node:process";
import http from 'http';

const PORT = process.env.PORT || 8084;

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
            service: 'Paragraph Audio Preview WebSocket Server',
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================
const wss = new WebSocketServer({ server });

console.log(`WebSocket server starting on port ${PORT}`);

// Store session state: Map<WebSocket, { lastBlockContent: Object | null }>
const sessionState = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');
    sessionState.set(ws, { lastBlockContent: null });

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', JSON.stringify(data).substring(0, 200));

            const {
                project_id,
                chapter_id,
                block_id,
                access_token,
                eleven_labs_api_key
            } = data;

            // Validate required fields
            if (!project_id || !chapter_id || !block_id || !access_token || !eleven_labs_api_key) {
                ws.send(JSON.stringify({ 
                    status: 'error', 
                    message: 'Missing required fields: project_id, chapter_id, block_id, access_token, eleven_labs_api_key' 
                }));
                return;
            }

            // Start Processing
            await processParagraphAudioGeneration(ws, project_id, chapter_id, block_id, access_token, eleven_labs_api_key, data.force_regenerate);

        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ status: 'error', message: `Server error: ${error.message}` }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        sessionState.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Helper to call internal Edge Function
async function fetchBlockAudioLog(projectId, studioId, chapterId, blockId, accessToken, supabaseUrl) {
    try {
        const url = `${supabaseUrl}/functions/v1/getBlockAudioLog?project_id=${projectId}&studio_id=${studioId}&chapter_id=${chapterId}&block_id=${blockId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`fetchBlockAudioLog failed: ${response.status}`);
            return null;
        }

        const data = await response.json();
        // data: { status: "success", exists: boolean, block_snapshot: ... }
        if (data && data.exists) {
            return data.block_snapshot;
        }
        return null;
    } catch (error) {
        console.error("fetchBlockAudioLog error:", error);
        return null;
    }
}

async function saveBlockAudioLog(projectId, studioId, chapterId, blockId, blockSnapshot, accessToken, supabaseUrl) {
    try {
        const url = `${supabaseUrl}/functions/v1/saveBlockAudioLog`;
        const formData = new FormData();
        formData.append('project_id', projectId);
        formData.append('studio_id', studioId);
        formData.append('chapter_id', chapterId);
        formData.append('block_id', blockId);
        formData.append('block_snapshot', JSON.stringify(blockSnapshot));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
                // Content-Type is set automatically with boundary for FormData
            },
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`saveBlockAudioLog failed: ${response.status} - ${text}`);
        } else {
             console.log("Block audio log saved successfully.");
        }
    } catch (error) {
        console.error("saveBlockAudioLog error:", error);
    }
}

async function processParagraphAudioGeneration(ws, projectId, chapterId, blockId, accessToken, elevenLabsApiKey, _forceRegenerate = false) {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co';
    const _session = sessionState.get(ws);

    try {
        ws.send(JSON.stringify({ status: 'validating_request', message: 'Validating request...' }));
        
        // 1. Fetch current block content from DB (to get text + voice_id)
        ws.send(JSON.stringify({ status: 'fetching_content', message: 'Fetching block content...' }));
        
        const currentBlockContent = await fetchBlockContent(projectId, chapterId, blockId, accessToken, SUPABASE_URL);
        
        if (!currentBlockContent) {
             throw new Error("Failed to fetch block content or block not found");
        }

        const studioId = currentBlockContent.studioId;
        if (!studioId) {
             throw new Error("Could not determine studio_id from block fetch");
        }

        // Remove studioId from object before comparison/saving to keep snapshot clean if strictly needed?
        // But fetchBlockContent returns it. Let's keep a clean snapshot for comparison.
        const cleanBlockSnapshot = { ...currentBlockContent };
        delete cleanBlockSnapshot.studioId;

        // 2. Retrieve last snapshot from logs
        ws.send(JSON.stringify({ status: 'checking_cache', message: 'Checking audio logs...' }));
        const lastSnapshot = await fetchBlockAudioLog(projectId, studioId, chapterId, blockId, accessToken, SUPABASE_URL);

        // 3. Check if file exists in storage
        const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/audio_files/${studioId}/blocks/${blockId}.txt`;
        const fileExists = await checkFileExists(fileUrl);

        // 4. Compare
        const isChanged = !deepComparison(cleanBlockSnapshot, lastSnapshot);
        console.log(`State Check - Changed: ${isChanged}, Exists: ${fileExists}`);

        // Logic (ignoring forceRegenerate as requested)
        // If file exists AND content hasn't changed -> Return existing
        if (fileExists && !isChanged) {
             console.log("No changes and file exists. Returning existing URL:", fileUrl);
             
             ws.send(JSON.stringify({ 
                status: 'complete', 
                message: 'Content unchanged, audio exists.', 
                data: {
                    file_id: "", 
                    url: fileUrl,
                    block_id: blockId,
                    cached: true
                } 
            }));
            return;
        }

        // Else: Generate & Save Log
        ws.send(JSON.stringify({ status: 'generating_audio', message: 'Generating audio for paragraph...' }));

        const generateUrl = `${SUPABASE_URL}/functions/v1/generateAudioForParagraph`;
        
        const generateFormData = new FormData();
        generateFormData.append('projectId', projectId);
        generateFormData.append('chapterId', chapterId);
        generateFormData.append('blockId', blockId);

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
        
        // Save the log (Fire and forget, or await? Await is safer to ensure it's logged)
        await saveBlockAudioLog(projectId, studioId, chapterId, blockId, cleanBlockSnapshot, accessToken, SUPABASE_URL);

        // Complete
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

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchBlockContent(projectId, chapterId, blockId, accessToken, supabaseUrl) {
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
            console.error(`fetchBlockContent failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(`Response body: ${text}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`getAllChapters response data keys: ${Object.keys(data).join(', ')}`);
        if (data.chapters) {
             console.log(`Chapters count: ${data.chapters.length}`);
        } else {
             console.log("No 'chapters' key in response data");
        }
         // data: { status: "success", chapters: [ ... ] }
         
        if (data.chapters && data.chapters.length > 0) {
            const chapter = data.chapters[0];
            
            // Filter for block
            console.log("Chapter found:", chapter.chapter_id);
            const blocks = chapter.content?.blocks || [];
            console.log(`Found ${blocks.length} blocks in chapter.`);
            
            // Log block IDs for debugging
            console.log("Available Block IDs:", blocks.map(b => b.block_id).join(", "));
            
            const block = blocks.find(b => b.block_id === blockId);
            
            if (block) {
                // Log the text content snippet for debugging stale content
                const firstNodeText = block.nodes && block.nodes.length > 0 ? block.nodes[0].text : "No nodes";
                console.log(`Block Content Preview: "${firstNodeText.substring(0, 100)}..."`);

                // Attach studio_id for our internal use if possible. 
                // If chapter doesn't have it, we might need to fetch project.
                // Let's assume we need to fetch project to be safe for studio_id.
                 const projectUrl = `${supabaseUrl}/functions/v1/getProjectById?id=${projectId}`;
                 console.log("Fetching project:", projectUrl);
                 const projectResp = await fetch(projectUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                 });

                 console.log("Project Response Status:", projectResp.status);
                 let studioId = null;
                 if (projectResp.ok) {
                     const pData = await projectResp.json();
                     console.log("Project Data:", JSON.stringify(pData).substring(0, 200));
                     studioId = pData.project?.studio_id;
                 } else {
                     const errText = await projectResp.text();
                     console.error("Project fetch failed:", errText);
                 }
                
                // User requirement: EXCLUDE comments from fetchBlockContent response
                if (block.comments) {
                    delete block.comments;
                }

                return { ...block, studioId };
            } else {
                console.error(`Block ${blockId} not found in chapter ${chapterId}`);
            }
        } else {
            console.error("No chapters found or empty chapters array");
        }
        return null;
    } catch (err) {
        console.error("fetchBlockContent error:", err);
        return null;
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

server.listen(PORT, () => {
    console.log(`Paragraph Audio Preview Server running on port ${PORT}`);
});
