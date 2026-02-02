import { WebSocketServer } from 'ws';
// fetch is global in Node 18+
import http from 'http';

console.log('Initializing manuscript processing server...');
import fs from 'fs';
import path from 'path';
import https from 'https';
import mammoth from 'mammoth';
import EPub from 'epub2';
import pdfParse from 'pdf-parse';

const PORT = process.env.PORT || 8080;

// =============================================================================
// CONFIGURATION
// =============================================================================
const ENABLE_AI_MODE = false; // Set to true to use OpenAI, false for programmatic generation

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

            if (ENABLE_AI_MODE && !data.open_ai_api_key) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing open_ai_api_key (required in AI mode)' }));
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
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extracts sections from manuscript text using flexible pattern matching.
 * Supports: "Chapter X", "Part X", "Section X", or any heading-like pattern.
 * If no structure found, treats entire text as one section.
 */
function extractChaptersFromText(text) {
    // Try multiple patterns in order of specificity
    const patterns = [
        /(?=^(?:Chapter|CHAPTER)\s+\d+)/gim,           // Chapter 1, Chapter 2
        /(?=^(?:Part|PART)\s+\d+)/gim,                 // Part 1, Part 2  
        /(?=^(?:Section|SECTION)\s+\d+)/gim,           // Section 1, Section 2
        /(?=^(?:Book|BOOK)\s+\d+)/gim,                 // Book 1, Book 2
        /(?=^[A-Z][A-Za-z\s]{0,50}:)/gm                // Any capitalized heading with colon
    ];
    
    let chapters = [];
    
    // Try each pattern until we find chapters
    for (const pattern of patterns) {
        const parts = text.split(pattern).filter(p => p.trim().length > 0);
        
        if (parts.length > 1) {
            // Found structure with this pattern
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.length > 0) {
                    const firstLineEnd = trimmed.indexOf('\n');
                    const title = firstLineEnd > -1 
                        ? trimmed.substring(0, firstLineEnd).trim() 
                        : trimmed.substring(0, 100).trim();
                    chapters.push({ title, content: trimmed });
                }
            }
            break; // Found structure, stop trying patterns
        }
    }
    
    // If no structure found, treat as single document
    if (chapters.length === 0) {
        chapters.push({ title: 'Full Manuscript', content: text });
    }
    
    return chapters;
}

/**
 * Splits a long chapter into smaller parts by paragraph boundaries.
 * Max chunk size is 2500 characters to stay well under OpenAI token limits.
 */
function splitLongChapter(chapter, maxChunkSize = 2500) {
    const { title, content } = chapter;
    
    // If chapter is small enough, return as-is
    if (content.length <= maxChunkSize) {
        return [chapter];
    }
    
    // Split by paragraphs (double newlines)
    const paragraphs = content.split(/\n\n+/);
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;
    
    for (const para of paragraphs) {
        const paraLength = para.length + 2; // +2 for the \n\n we'll add back
        
        // If adding this paragraph exceeds limit, save current chunk and start new one
        if (currentLength + paraLength > maxChunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n\n'));
            currentChunk = [para];
            currentLength = paraLength;
        } else {
           currentChunk.push(para);
            currentLength += paraLength;
        }
    }
    
    // Don't forget the last chunk
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
    }
    
    // Create chapter objects with part numbers
    return chunks.map((chunk, index) => ({
        title: chunks.length > 1 ? `${title} Part ${index + 1}` : title,
        content: chunk
    }));
}

/**
 * Converts chapter content to ElevenLabs JSON format programmatically (NO-AI MODE).
 * Splits text into paragraphs and creates proper block/node structure.
 */
function chapterToJson(chapterTitle, chapterContent, voiceId) {
    const blocks = [];
    
    // First block: chapter heading as h2
    blocks.push({
        sub_type: 'h2',
        nodes: [{
            voice_id: voiceId,
            text: chapterTitle,
            type: 'tts_node'
        }]
    });
    
    // Split content into paragraphs
    const paragraphs = chapterContent
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
    
    // Skip first paragraph if it's just the chapter title
    const contentStart = paragraphs[0] === chapterTitle ? 1 : 0;
    
    // Create a block for each paragraph
    for (let i = contentStart; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        
        // Check if paragraph contains dialogue (quotes)
        const hasDialogue = paragraph.includes('"') || paragraph.includes("'");
        
        if (hasDialogue) {
            // Split into dialogue and narration nodes
            const nodes = splitDialogueAndNarration(paragraph, voiceId);
            blocks.push({
                sub_type: 'p',
                nodes: nodes
            });
        } else {
            // Simple narration block
            blocks.push({
                sub_type: 'p',
                nodes: [{
                    voice_id: voiceId,
                    text: paragraph,
                    type: 'tts_node'
                }]
            });
        }
    }
    
    return blocks;
}

/**
 * Splits a paragraph containing dialogue into separate nodes (NO-AI MODE).
 * Simple heuristic: text in quotes = dialogue, rest = narration.
 */
function splitDialogueAndNarration(paragraph, voiceId) {
    const nodes = [];
    
    // Simple regex to find quoted text
    const quoteRegex = /["']([^"']+)["']/g;
    let lastIndex = 0;
    let match;
    
    while ((match = quoteRegex.exec(paragraph)) !== null) {
        // Add narration before the quote
        if (match.index > lastIndex) {
            const narration = paragraph.substring(lastIndex, match.index).trim();
            if (narration) {
                nodes.push({
                    voice_id: voiceId,
                    text: narration,
                    type: 'tts_node'
                });
            }
        }
        
        // Add the dialogue (without quotes)
        nodes.push({
            voice_id: voiceId,
            text: match[1],
            type: 'tts_node'
        });
        
        lastIndex = quoteRegex.lastIndex;
    }
    
    // Add any remaining narration after the last quote
    if (lastIndex < paragraph.length) {
        const narration = paragraph.substring(lastIndex).trim();
        if (narration) {
            nodes.push({
                voice_id: voiceId,
                text: narration,
                type: 'tts_node'
            });
        }
    }
    
    // If no dialogue was found, return single node
    if (nodes.length === 0) {
        nodes.push({
            voice_id: voiceId,
            text: paragraph,
            type: 'tts_node'
        });
    }
    
    return nodes;
}

/**
 * Processes a single chapter with OpenAI and returns formatted blocks.
 */
async function processChapterWithOpenAI(chapterText, chapterTitle, voiceId, apiKey) {
    const prompt = `Convert this chapter into JSON blocks for TTS.

CHAPTER: ${chapterTitle}

TEXT:
${chapterText}

RULES:
- Create a BLOCK for each paragraph
- First block: chapter heading, sub_type="h2"
- Other blocks: sub_type="p"
- All voice_id="${voiceId}", type="tts_node"

Return JSON array of blocks:
[
  {"sub_type": "h2", "nodes": [{"voice_id": "${voiceId}", "text": "Chapter Title", "type": "tts_node"}]},
  {"sub_type": "p", "nodes": [{"voice_id": "${voiceId}", "text": "paragraph text", "type": "tts_node"}]}
]`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4-1106-preview',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    
    // Extract blocks array (might be wrapped)
    let blocks = content;
    if (!Array.isArray(blocks)) {
        for (const key of ['blocks', 'data', 'content', 'chapters']) {
            if (content[key] && Array.isArray(content[key])) {
                blocks = content[key];
                break;
            }
        }
        if (!Array.isArray(blocks)) blocks = [blocks];
    }
    
    return blocks;
}

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

        // Extract chapters from manuscript
        ws.send(JSON.stringify({ status: 'processing', message: 'Detecting chapters...' }));
        const rawChapters = extractChaptersFromText(manuscriptText);
        console.log(`Found ${rawChapters.length} chapter(s)`);
        
        // Split long chapters into manageable parts
        const chapters = [];
        for (const chapter of rawChapters) {
            const parts = splitLongChapter(chapter);
            if (parts.length > 1) {
                console.log(`Split "${chapter.title}" into ${parts.length} parts (${chapter.content.length} chars)`);
            }
            chapters.push(...parts);
        }
        console.log(`Total chapters after splitting: ${chapters.length}`);
        
        // Process each chapter (AI or No-AI mode)
        const processingMode = ENABLE_AI_MODE ? 'OpenAI' : 'Programmatic';
        ws.send(JSON.stringify({ 
            status: 'processing', 
            message: `Processing ${chapters.length} chapter(s) [${processingMode} mode]...` 
        }));
        const generatedContent = [];
        
        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];
            ws.send(JSON.stringify({ 
                status: 'processing', 
                message: `Processing chapter ${i + 1}/${chapters.length}...` 
            }));
            
            try {
                let blocks;
                
                if (ENABLE_AI_MODE) {
                    // AI MODE: Use OpenAI for intelligent processing
                    blocks = await processChapterWithOpenAI(
                        chapter.content,
                        chapter.title,
                        voice_id,
                        open_ai_api_key
                    );
                } else {
                    // NO-AI MODE: Programmatic JSON generation
                    blocks = chapterToJson(
                        chapter.title,
                        chapter.content,
                        voice_id
                    );
                }
                
                generatedContent.push({
                    name: chapter.title,
                    blocks: blocks
                });
                
                console.log(`Chapter ${i + 1}/${chapters.length} processed: ${blocks.length} blocks`);
            } catch (error) {
                console.error(`Error processing chapter ${i + 1}:`, error.message);
                // Continue with other chapters even if one fails
            }
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

        // Fetch gallery_id from project
        const { data: galleryFetchData, error: galleryFetchError } = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}&select=gallery_id`, {
             headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`
            }
        }).then(res => res.json());

        const galleryId = (galleryFetchData && galleryFetchData.length > 0) ? galleryFetchData[0].gallery_id : null;

        // Fetch Chapters from ElevenLabs
        const chaptersResponse = await fetch(`https://api.elevenlabs.io/v1/studio/projects/${elevenLabsProjectId}/chapters`, {
            method: 'GET',
            headers: { 'xi-api-key': eleven_labs_api_key }
        });

        if (!chaptersResponse.ok) {
             throw new Error(`Failed to fetch chapters: ${await chaptersResponse.text()}`);
        }

        const chaptersData = await chaptersResponse.json();
        const elevenLabsChapters = chaptersData.chapters || [];

        // Build Studio Chapters List
        const studioChapters = [];

        for (const chapter of elevenLabsChapters) {
             const chapterId = chapter.chapter_id;
             // Fetch content for each chapter
             const contentResponse = await fetch(`https://api.elevenlabs.io/v1/studio/projects/${elevenLabsProjectId}/chapters/${chapterId}`, {
                 method: 'GET',
                 headers: { 'xi-api-key': eleven_labs_api_key }
             });

             let contentJson = {};
             if (contentResponse.ok) {
                 const contentData = await contentResponse.json();
                 contentJson = contentData.content || {}; 
             } else {
                 console.warn(`Failed to fetch content for chapter ${chapterId}`);
             }

             studioChapters.push({
                 id: chapterId,
                 name: chapter.name,
                 content_json: contentJson
             });
        }

        // Insert into Studio Table
        const studioInsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/studio`, {
            method: 'POST',
            headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`, 
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                id: elevenLabsProjectId, // Use ElevenLabs ID as Studio ID
                gallery_id: galleryId,
                chapters: studioChapters,
                voices: [{ id: voice_id, status: 'CAST' }],
                complete_content_json: {}, // As requested
                comments: []
            })
        });

        if (!studioInsertResponse.ok) {
            console.error('Failed to create studio record:', await studioInsertResponse.text());
        }

        // Update Project with Studio ID
        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`, 
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ studio_id: elevenLabsProjectId })
        });

        if (!updateResponse.ok) {
            const errorBody = await updateResponse.text();
            console.error('Database update failed:', updateResponse.status, errorBody);
        }
        
        console.log(`ElevenLabs Project Created: ${elevenLabsProjectId}, Studio Record Created.`);

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
