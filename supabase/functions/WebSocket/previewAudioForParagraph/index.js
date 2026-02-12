import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8084;

// Simple deep equal helper
function deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== "object" || obj1 === null || typeof obj2 !== "object" || obj2 === null) return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
        if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) return false;
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

async function processParagraphAudioGeneration(ws, projectId, chapterId, blockId, accessToken, elevenLabsApiKey, forceRegenerate = false) {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co';
    const session = sessionState.get(ws);

    try {
        ws.send(JSON.stringify({ status: 'validating_request', message: 'Validating request...' }));
        
        // 1. Fetch current block content from DB
        ws.send(JSON.stringify({ status: 'fetching_content', message: 'Fetching block content...' }));
        
        const currentBlockContent = await fetchBlockContent(projectId, chapterId, blockId, accessToken, SUPABASE_URL);
        
        if (!currentBlockContent) {
             throw new Error("Failed to fetch block content or block not found");
        }

        // 2. Check content change
        // If session.lastBlockContent is null, treat as 'changed' (first run), 
        // OR strictly check against it?
        // Let's compare with session state. If null, it's effectively "new/changed".
        const isChanged = !deepEqual(currentBlockContent, session.lastBlockContent);
        
        // 3. Check if file exists in storage
        ws.send(JSON.stringify({ status: 'checking_cache', message: 'Checking audio cache...' }));
        
        const studioId = currentBlockContent.studioId; // We need to update fetchBlockContent to return this
        if (!studioId) {
             throw new Error("Could not determine studio_id from block fetch");
        }
        
        // Construct public URL to check HEAD
        const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/audio_files/${studioId}/blocks/${blockId}.txt`;
        const fileExists = await checkFileExists(fileUrl);
        
        console.log(`State Check - Changed: ${isChanged}, Exists: ${fileExists}, Force: ${forceRegenerate}`);

        // Logic
        // 1) Force Regenerate -> Generate
        // 2) Change + Exists -> Overwrite (Generate)
        // 3) Change + !Exists -> Generate
        // 4) !Change + !Exists -> Generate
        // 5) !Change + Exists -> Return Existing (Skip)
        
        if (!forceRegenerate && !isChanged && fileExists) {
             console.log("No changes and file exists. Returning existing URL:", fileUrl);
             
             // Update session state just in case (though equal)
             session.lastBlockContent = currentBlockContent;
             
             ws.send(JSON.stringify({ 
                status: 'complete', 
                message: 'Content unchanged, audio exists.', 
                data: {
                    file_id: "", // Placeholder as we didn't DB query
                    url: fileUrl,
                    block_id: blockId,
                    cached: true
                } 
            }));
            return;
        }

        // Else: Generate
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
        
        // Update session state with the content we just generated for
        session.lastBlockContent = currentBlockContent;

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
