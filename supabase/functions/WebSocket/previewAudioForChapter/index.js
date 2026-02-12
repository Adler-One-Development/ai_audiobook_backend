import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8083;

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
        // 1. Convert Chapter
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

        // 2. Poll for new snapshot
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
                    // Note: ElevenLabs might take a few seconds to process
                    // We look for the most recent one that is newer than startTimeUnix
                    
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

        // 3. Generate Audio
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

        // 3. Complete
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
