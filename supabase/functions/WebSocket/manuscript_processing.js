import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import http from 'http';
import fs from 'fs';
import path from 'path';
import https from 'https';
import mammoth from 'mammoth';
import EPub from 'epub2';
import pdfParse from 'pdf-parse';

const PORT = process.env.PORT || 8080;

// =============================================================================
// HTTP SERVER WITH WEBSOCKET SUPPORT
// =============================================================================
const server = http.createServer((req, res) => {
    // Health check endpoint for Cloud Run
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'Project Creation WebSocket Server',
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
            console.log('Received:', data);

            // Validate required fields
            if (!data.project_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing project_id' }));
                return;
            }

            if (!data.supabase_anon_key) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing supabase_anon_key' }));
                return;
            }

            if (!data.eleven_labs_api_key) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing eleven_labs_api_key' }));
                return;
            }

            if (!data.voice_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing voice_id' }));
                return;
            }

            if (!data.open_ai_api_key) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing open_ai_api_key' }));
                return;
            }

            await processProjectCreation(ws, data);
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON or server error' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// =============================================================================
// PROJECT CREATION LOGIC
// =============================================================================

async function processProjectCreation(ws, data) {
    try {
        const { project_id, access_token, supabase_anon_key, eleven_labs_api_key, voice_id, open_ai_api_key } = data;

        ws.send(JSON.stringify({ status: 'processing', message: 'Preparing your project...' }));

        // Fetch project using user's access token
        const SUPABASE_URL = "https://hskaqvjruqzmgrwxmxxd.supabase.co";
        const getProjectUrl = `${SUPABASE_URL}/functions/v1/getProjectById?id=${project_id}`;
        
        const projectResponse = await fetch(getProjectUrl, {
            headers: { 'Authorization': `Bearer ${access_token || supabase_anon_key}` }
        });

        if (!projectResponse.ok) {
            throw new Error('Failed to fetch project');
        }

        const projectData = await projectResponse.json();
        const project = projectData.project;

        if (!project) {
            throw new Error('Project not found');
        }

        // Download manuscript
        const galleryFiles = project.gallery?.files || [];
        if (galleryFiles.length === 0) {
            throw new Error('No manuscript file found');
        }

        ws.send(JSON.stringify({ status: 'processing', message: 'Loading manuscript...' }));

        const fileUrl = galleryFiles[0].url;
        const fileExt = fileUrl.split('.').pop().split('?')[0].toLowerCase();
        const tempFilePath = path.join('/tmp', `manuscript_${Date.now()}.${fileExt}`);

        await downloadFile(fileUrl, tempFilePath);

        // Extract text from manuscript
        ws.send(JSON.stringify({ status: 'processing', message: 'Processing manuscript...' }));
        
        let manuscriptText;
        
        if (fileExt === 'txt' || fileExt === 'text') {
            manuscriptText = fs.readFileSync(tempFilePath, 'utf8');
        } else if (fileExt === 'docx' || fileExt === 'doc') {
            // Extract text from DOCX/DOC using mammoth
            const result = await mammoth.extractRawText({ path: tempFilePath });
            manuscriptText = result.value;
        } else if (fileExt === 'rtf') {
            // RTF files can often be read as plain text (simplified approach)
            manuscriptText = fs.readFileSync(tempFilePath, 'utf8');
        } else if (fileExt === 'pdf') {
            // Extract text from PDF
            const dataBuffer = fs.readFileSync(tempFilePath);
            const pdfData = await pdfParse(dataBuffer);
            manuscriptText = pdfData.text;
        } else if (fileExt === 'epub') {
            // Extract text from EPUB
            const epub = new EPub(tempFilePath);
            await new Promise((resolve, reject) => {
                epub.on('end', resolve);
                epub.on('error', reject);
                epub.parse();
            });
            
            // Get all chapters and extract text
            const chapters = epub.flow;
            const chapterTexts = [];
            
            for (const chapter of chapters) {
                const chapterText = await new Promise((resolve, reject) => {
                    epub.getChapterRaw(chapter.id, (error, text) => {
                        if (error) reject(error);
                        else {
                            // Strip HTML tags (basic approach)
                            const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                            resolve(stripped);
                        }
                    });
                });
                chapterTexts.push(chapterText);
            }
            
            manuscriptText = chapterTexts.join('\n\n');
        } else {
            // Try reading as text for unknown formats
            manuscriptText = fs.readFileSync(tempFilePath, 'utf8');
        }
        
        fs.unlinkSync(tempFilePath);

        // Call OpenAI with proper prompt
        ws.send(JSON.stringify({ status: 'processing', message: 'Analyzing content...' }));
        
        // Use first 3000 characters for testing
        const manuscriptSample = manuscriptText.substring(0, 3000);
        
        const prompt = `You are an expert TTS Script Parser. Convert this manuscript to JSON format for ElevenLabs TTS.

VOICE MAP:
Narrator: ${voice_id}

MANUSCRIPT:
${manuscriptSample}

Return ONLY a JSON array with this structure:
[
  {
    "name": "Chapter Title",
    "blocks": [
      {
        "sub_type": "p",
        "nodes": [
          {
            "voice_id": "${voice_id}",
            "text": "The text content",
            "type": "tts_node"
          }
        ]
      }
    ]
  }
]

IMPORTANT: Return ONLY the JSON array, no other text.`;

        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${open_ai_api_key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4-1106-preview',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });

        if (!openaiResponse.ok) {
            const errorBody = await openaiResponse.text();
            console.error('OpenAI API Error:', openaiResponse.status, errorBody);
            throw new Error(`OpenAI request failed: ${openaiResponse.status} - ${errorBody}`);
        }

        const openaiData = await openaiResponse.json();
        let generatedContent = JSON.parse(openaiData.choices[0].message.content);
        
        // ElevenLabs expects an array, wrap if it's not
        if (!Array.isArray(generatedContent)) {
            generatedContent = [generatedContent];
        }

        // Call ElevenLabs
        ws.send(JSON.stringify({ status: 'processing', message: 'Preparing audio project...' }));

        const formData = new URLSearchParams();
        formData.append('name', project.book?.title || 'Untitled Project');
        
        console.log('Generated content type:', Array.isArray(generatedContent) ? 'Array' : 'Object');
        console.log('Generated content:', JSON.stringify(generatedContent).substring(0, 200));
        
        formData.append('from_content_json', JSON.stringify(generatedContent));

        const elResponse = await fetch('https://api.elevenlabs.io/v1/studio/projects', {
            method: 'POST',
            headers: {
                'xi-api-key': eleven_labs_api_key,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        if (!elResponse.ok) {
            const errorBody = await elResponse.text();
            console.error('ElevenLabs API Error:', elResponse.status, errorBody);
            throw new Error(`ElevenLabs request failed: ${elResponse.status} - ${errorBody}`);
        }

        const elData = await elResponse.json();
        const elevenLabsProjectId = elData.project.project_id;

        // Update Supabase
        ws.send(JSON.stringify({ status: 'processing', message: 'Finalizing...' }));

        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`, // Use user token for write permissions
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ eleven_labs_project_id: elevenLabsProjectId })
        });

        if (!updateResponse.ok) {
            const errorBody = await updateResponse.text();
            console.error('Database update failed:', updateResponse.status, errorBody);
            // Don't throw error, just log it - project was created successfully
        }

        ws.send(JSON.stringify({
            status: 'success',
            message: 'Project created successfully',
            data: { eleven_labs_project_id: elevenLabsProjectId }
        }));

    } catch (error) {
        console.error('Project creation failed:', error);
        ws.send(JSON.stringify({ status: 'error', message: error.message }));
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} with WebSocket support`);
});
