import { WebSocketServer } from 'ws';
import process from "node:process";
import http from 'http';
import { createClient } from '@supabase/supabase-js';
import { Readable } from 'node:stream';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhza2FxdmpydXF6bWdyd3hteHhkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODIzNzk0NSwiZXhwIjoyMDgzODEzOTQ1fQ.5phCCOdf2PRpRE6kI5yrkjHfTtC4Yp2Ajg27s7shLCs';

if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations will fail.');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FileType = Object.freeze({
    TXT: 'txt',
    MP3: 'mp3'
});

const CURRENT_FILE_TYPE = FileType.MP3;



const PORT = process.env.PORT || 8085;

// =============================================================================
// HTTP SERVER WITH WEBSOCKET SUPPORT
// =============================================================================
const server = http.createServer((req, res) => {
    // Health check endpoint for Cloud Run
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'Generate Complete Audio WebSocket Server',
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
                access_token,
                eleven_labs_api_key
            } = data;

            // Validate required fields
            if (!project_id || !access_token || !eleven_labs_api_key) {
                ws.send(JSON.stringify({ 
                    status: 'error', 
                    message: 'Missing required fields: project_id, access_token, eleven_labs_api_key' 
                }));
                return;
            }

            // Start Processing
            await processProjectAudioGeneration(ws, project_id, access_token, eleven_labs_api_key);

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

async function processProjectAudioGeneration(ws, projectId, accessToken, elevenLabsApiKey) {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hskaqvjruqzmgrwxmxxd.supabase.co';

    try {
        // 1. Trigger Conversion
        ws.send(JSON.stringify({ status: 'processing', message: 'Starting project conversion...' }));
        
        const convertUrl = `${SUPABASE_URL}/functions/v1/convertProject`;
        const startTimeUnix = Math.floor(Date.now() / 1000); // Current time in Unix timestamp

        const convertFormData = new FormData();
        convertFormData.append('project_id', projectId);

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
        ws.send(JSON.stringify({ status: 'processing', message: convertResponse.json() }));

        ws.send(JSON.stringify({ 
            status: 'processing', 
            message: 'Conversion initiated. Waiting for snapshot to be created...' 
        }));

        // 2. Poll for new snapshot
        let projectSnapshotId = null;
        const maxRetries = 40; // 40 attempts (~2 minutes with 3s interval) - Projects can take longer
        const pollInterval = 3000; // 3 seconds

        for (let i = 0; i < maxRetries; i++) {
            const snapshotsUrl = `${SUPABASE_URL}/functions/v1/getProjectSnapshots?project_id=${projectId}`;
            
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
                        projectSnapshotId = newSnapshot.project_snapshot_id;
                        console.log(`Found new snapshot: ${projectSnapshotId} (created: ${newSnapshot.created_at_unix})`);
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

        if (!projectSnapshotId) {
            throw new Error('Timeout: Failed to obtain new project snapshot ID after conversion.');
        }

        ws.send(JSON.stringify({ 
            status: 'processing', 
            message: 'Project converted and snapshot verified', 
            snapshot_id: projectSnapshotId 
        }));

        // 3. Generate Audio
        ws.send(JSON.stringify({ status: 'generating_audio', message: 'Generating audio for project (Internal Process)...' }));

        const generateData = await generateAudioInternal(ws, projectId, projectSnapshotId, accessToken, elevenLabsApiKey);

        // 4. Complete
        ws.send(JSON.stringify({ 
            status: 'complete', 
            message: 'Audio generation completed', 
            data: generateData 
        }));

    } catch (error) {
        console.error('Process error:', error);
        ws.send(JSON.stringify({ 
            status: 'error', 
            message: `Process failed: ${error.message || error}` 
        }));
    }
}

async function generateAudioInternal(ws, projectId, projectSnapshotId, accessToken, elevenLabsApiKey) {
    // 1. Get project and verify access + get studio_id and gallery_id
    // We use the accessToken to verify the user identity first
    const { data: { user }, error: authError } = await adminClient.auth.getUser(accessToken);
    if (authError || !user) {
        throw new Error("Unauthorized: Invalid access token");
    }

    const { data: project, error: projectError } = await adminClient
        .from("projects")
        .select("studio_id, gallery_id")
        .eq("id", projectId)
        .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`)
        .single();

    if (projectError || !project) {
        throw new Error("Project not found or access denied");
    }

    if (!project.studio_id) {
        throw new Error("Project does not have a studio associated");
    }

    const studioId = project.studio_id;

    // 2. Fetch studio data to calculate cost
    const { data: studio, error: studioError } = await adminClient
        .from("studio")
        .select("chapters")
        .eq("id", studioId)
        .single();

    if (studioError || !studio) {
        throw new Error("Failed to fetch studio details");
    }

    // Calculate characters across ALL chapters
    let totalProjectCharacters = 0;
    const chapters = studio.chapters || [];

    chapters.forEach((chapter) => {
        if (chapter.content_json && Array.isArray(chapter.content_json.blocks)) {
            chapter.content_json.blocks.forEach((block) => {
                if (Array.isArray(block.nodes)) {
                    block.nodes.forEach((node) => {
                        if (node.text) {
                            totalProjectCharacters += node.text.length;
                        }
                    });
                }
            });
        }
    });

    const creditCost = Math.ceil(totalProjectCharacters / 1000);
    console.log(`Internal Audio Generation - Project Chars: ${totalProjectCharacters}, Cost: ${creditCost} credits`);
    ws.send(JSON.stringify({ status: 'processing', message: `Validated project: ${totalProjectCharacters} characters, cost: ${creditCost} credits` }));

    // Get available credits
    const { data: creditsData, error: creditsError } = await adminClient
        .from("credits_allocation")
        .select("credits_available, credits_used, total_credits_used")
        .eq("user_id", user.id)
        .single();

    if (creditsError || !creditsData) {
        throw new Error("Failed to fetch credit balance");
    }

    if (creditsData.credits_available < creditCost) {
        throw new Error(`Insufficient credits. Required: ${creditCost}, Available: ${creditsData.credits_available}`);
    }

    // 3. Call ElevenLabs Stream API
    console.log(`Streaming project snapshot: ${projectSnapshotId}`);
    ws.send(JSON.stringify({ status: 'processing', message: 'Streaming audio from ElevenLabs (this may take several minutes)...' }));

    const streamResponse = await fetch(
        `https://api.elevenlabs.io/v1/studio/projects/${studioId}/snapshots/${projectSnapshotId}/stream`,
        {
            method: "POST",
            headers: {
                "xi-api-key": elevenLabsApiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ "convert_to_mpeg": true }),
        }
    );

    if (!streamResponse.ok) {
        const errorText = await streamResponse.text();
        console.error("ElevenLabs Stream Error:", errorText);
        throw new Error(`ElevenLabs Stream Error: ${streamResponse.status} - ${errorText}`);
    }

    let fileData;
    if (CURRENT_FILE_TYPE === FileType.MP3) {
        fileData = Readable.fromWeb(streamResponse.body);
        console.log(`Processing as MP3 stream`);
        ws.send(JSON.stringify({ status: 'processing', message: 'Processing audio stream. Uploading to storage...' }));
    } else {
        fileData = await streamResponse.blob();
        console.log(`Received audio blob, size: ${fileData.size} bytes`);
        ws.send(JSON.stringify({ status: 'processing', message: `Received audio blob (${(fileData.size / 1024 / 1024).toFixed(2)} MB). Uploading to storage...` }));
    }

    // 4. Upload to Storage
    const { fileId, fileUrl } = await uploadToSupabaseStorage(adminClient, studioId, fileData, CURRENT_FILE_TYPE);



    // 5. Deduct Credits
    const { error: deductionError } = await adminClient.from("credits_allocation")
        .update({
            credits_available: creditsData.credits_available - creditCost,
            credits_used: (creditsData.credits_used || 0) + creditCost,
            total_credits_used: (creditsData.total_credits_used || 0) + creditCost
        })
        .eq("user_id", user.id);

    if (deductionError) {
        console.error("CRITICAL: Failed to deduct credits after generation!", deductionError);
        // We don't throw here because audio IS generated, but we log the critical error
    } else {
        console.log("Credits deducted successfully.");
    }

    return {
        status: "success",
        message: "Audio generated successfully",
        project_id: projectId,
        credits_used: creditCost,
        file: {
            id: fileId,
            url: fileUrl
        }
    };
}

async function uploadToSupabaseStorage(adminClient, studioId, fileBlob, fileType) {
    const extension = fileType === FileType.TXT ? 'txt' : 'mp3';
    const contentType = fileType === FileType.TXT ? 'text/plain' : 'audio/mpeg';
    const path = `${studioId}/complete_audiobook/${studioId}.${extension}`;

    const { data: _uploadData, error: uploadError } = await adminClient.storage
        .from("audio_files")
        .upload(path, fileBlob, {
            contentType,
            upsert: true,
            duplex: fileType === FileType.MP3 ? 'half' : undefined
        });


    if (uploadError) {
        console.error(`Storage Upload FAILED:`, uploadError);
        throw new Error(`Failed to upload file: ${uploadError.message}`);
    }

    const { data: publicUrlData } = adminClient.storage
        .from("audio_files")
        .getPublicUrl(path);

    return {
        fileId: crypto.randomUUID(),
        fileUrl: publicUrlData.publicUrl
    };
}


server.listen(PORT, () => {
    console.log(`Generate Complete Audio WebSocket Server running on port ${PORT}`);
});
