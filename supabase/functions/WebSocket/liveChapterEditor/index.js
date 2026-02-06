import { WebSocketServer } from 'ws';
import http from 'http';

// Simple deep equal helper to avoid dependencies
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

console.log('Initializing Live Chapter Editor server...');


const PORT = process.env.PORT || 8082;

// =============================================================================
// HTTP SERVER WITH WEBSOCKET SUPPORT
// =============================================================================
const server = http.createServer((req, res) => {
    // Health check endpoint for Cloud Run
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'Live Chapter Editor WebSocket Server',
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

// Store session state: Map<WebSocket, { currentContent: Object }>
const sessionState = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');
    sessionState.set(ws, { currentContent: null });

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            // console.log('Received message:', JSON.stringify(data).substring(0, 200) + '...'); 

            const {
                project_id,
                chapter_id,
                supabase_anon_key,
                access_token,
                eleven_labs_api_key,
                content // present on updates or empty on init
            } = data;
            
            // Validation common to both init and update
             if (!project_id || !chapter_id || !access_token) {
                 // Might be a simple ping or malformed?
                 // But strictly per requirements we need these to operate.
                 // We'll log and continue or send error?
                 // Let's assume reliable client, but send error if missing criticals
                 ws.send(JSON.stringify({ status: 'error', message: 'Missing required fields: project_id, chapter_id, access_token' }));
                 return;
             }

            // Get session
            const session = sessionState.get(ws);

            // =================================================================
            // INITIALIZATION / SYNC (No local content yet)
            // =================================================================
            if (!session.currentContent) {
                 console.log(`Initializing session for Project: ${project_id}, Chapter: ${chapter_id}`);
                 
                 // Fetch latest content from API
                 const fetchedContent = await fetchChapterContent(project_id, chapter_id, access_token);
                 
                 if (!fetchedContent) {
                     ws.send(JSON.stringify({ status: 'error', message: 'Failed to fetch chapter content' }));
                     return;
                 }
                 
                 // Update local session state
                 session.currentContent = fetchedContent;
                 
                 // Send response
                 ws.send(JSON.stringify({
                     status: "no changes detected",
                     connection_status: "CONNECTED",
                     action: "DO NOTHING",
                     content_json: fetchedContent
                 }));
                 return;
            }

            // =================================================================
            // UPDATE / COMPARISON (Local content exists)
            // =================================================================
            
            // If content is provided in message, compare it
            if (content && Object.keys(content).length > 0) {
                // Determine if changed
                // Use local deep comparison
                const isChanged = !deepEqual(content, session.currentContent);
                
                if (!isChanged) {
                    // No Change
                     ws.send(JSON.stringify({
                         status: "no changes detected",
                         connection_status: "CONNECTED",
                         action: "DO NOTHING",
                         content_json: session.currentContent // Return known good state
                     }));
                } else {
                    // Changes Detected
                    console.log('Changes detected! Updating ecosystem...');
                    
                    const updateSuccess = await updateChapterContent(project_id, chapter_id, content, access_token, eleven_labs_api_key);
                    
                    if (updateSuccess) {
                        // Update local state to new content
                        session.currentContent = content;
                        
                        ws.send(JSON.stringify({
                             status: "changes detected",
                             connection_status: "CONNECTED",
                             action: "UPDATE CHAPTER",
                             content_json: content
                        }));
                    } else {
                         ws.send(JSON.stringify({
                             status: "error",
                             message: "Failed to update chapter content in backend"
                        }));
                    }
                }
            } else {
                 // If content is empty/missing but we have session, treat as "sync/refresh" or "no-op"
                 // Just return current state
                 ws.send(JSON.stringify({
                     status: "no changes detected",
                     connection_status: "CONNECTED",
                     action: "DO NOTHING",
                     content_json: session.currentContent
                 }));
            }

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

server.listen(PORT, () => {
    console.log(`Live Chapter Editor Server running on port ${PORT}`);
});


// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchChapterContent(projectId, chapterId, accessToken) {
    try {
        const supabaseUrl = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co'; // Fallback for local testing if env missing
        const url = `${supabaseUrl}/functions/v1/getAllChapters?projectId=${projectId}&chapterId=${chapterId}`;
        
        console.log(`Fetching: ${url}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const txt = await response.text();
            console.error(`getAllChapters failed: ${response.status} - ${txt}`);
            return null;
        }
        
        const data = await response.json();
        
        // Structure: { status: "success", chapters: [ { content: { blocks: [...] }, ... } ] }
        if (data.chapters && data.chapters.length > 0) {
             const chapter = data.chapters[0];
             // User wants "content_json" to be this content object
             return chapter.content; 
        }
        
        console.warn('No chapters returned or empty array');
        return null; // Or empty object?
        
    } catch (err) {
        console.error('Fetch exception:', err);
        return null;
    }
}

async function updateChapterContent(projectId, chapterId, newContent, accessToken, elevenLabsApiKey) {
    try {
        const supabaseUrl = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co';
        const url = `${supabaseUrl}/functions/v1/editChapter`;
        
        console.log(`Updating via: ${url}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'eleven-labs-api-key': elevenLabsApiKey || '', // Might be optional if server uses env, but usually client provides
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                projectId: projectId,
                chapterId: chapterId,
                content: newContent
            })
        });
        
        if (!response.ok) {
             const txt = await response.text();
             console.error(`editChapter failed: ${response.status} - ${txt}`);
             return false;
        }
        
        return true;
        
    } catch (err) {
        console.error('Update exception:', err);
        return false;
    }
}
