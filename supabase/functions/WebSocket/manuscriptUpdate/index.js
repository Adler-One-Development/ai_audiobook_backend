import { WebSocketServer } from 'ws';
import http from 'http';

console.log('Initializing manuscript update server...');
import fs from 'fs';
import path from 'path';
import https from 'https';
import mammoth from 'mammoth';
import epubPkg from 'epub2';
const EPub = epubPkg.EPub || epubPkg.default || epubPkg;
import pdfParse from 'pdf-parse';

const PORT = process.env.PORT || 8081;

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
            service: 'Manuscript Update WebSocket Server',
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
            if (!data.gallery_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing gallery_id' }));
                return;
            }

            if (!data.file_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing file_id' }));
                return;
            }

            if (!data.studio_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing studio_id' }));
                return;
            }

            if (!data.supabase_anon_key) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing supabase_anon_key' }));
                return;
            }

            if (!data.eleven_labs_api_key) {
                ws.send(JSON.stringify({ status:'error', message: 'Missing eleven_labs_api_key' }));
                return;
            }

            if (!data.voice_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing voice_id' }));
                return;
            }

            await processManuscriptUpdate(ws, data);
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ status: 'error', message: `Invalid JSON or server error: ${error.message}` }));
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
// HELPER FUNCTIONS (Same as manuscriptProcessing)
// =============================================================================

/**
 * Extracts sections from manuscript text using flexible pattern matching.
 */
function extractChaptersFromText(text) {
    const patterns = [
        /(?=^(?:Chapter|CHAPTER)\s+\d+)/gim,
        /(?=^(?:Part|PART)\s+\d+)/gim,
        /(?=^(?:Section|SECTION)\s+\d+)/gim,
        /(?=^(?:Book|BOOK)\s+\d+)/gim,
        /(?=^[A-Z][A-Za-z\s]{0,50}:)/gm
    ];
    
    let chapters = [];
    
    for (const pattern of patterns) {
        const parts = text.split(pattern).filter(p => p.trim().length > 0);
        
        if (parts.length > 1) {
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
            break;
        }
    }
    
    if (chapters.length === 0) {
        chapters.push({ title: 'Full Manuscript', content: text });
    }
    
    return chapters;
}

/**
 * Splits a long chapter into smaller parts by paragraph boundaries.
 * If individual paragraphs are too long, splits them by sentences.
 * Max chunk size is 4000 characters to stay under ElevenLabs 4800 limit with safety margin.
 */
function splitLongChapter(chapter, maxChunkSize = 4000) {
    const { title, content } = chapter;
    
    if (content.length <= maxChunkSize) {
        return [chapter];
    }
    
    const paragraphs = content.split(/\n\n+/);
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;
    
    for (const para of paragraphs) {
        if (para.length > maxChunkSize) {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk.join('\n\n'));
                currentChunk = [];
                currentLength = 0;
            }
            
            const sentences = para.split(/(?<=[.!?])\s+/);
            let sentenceChunk = [];
            let sentenceLength = 0;
            
            for (const sentence of sentences) {
                const sentLen = sentence.length + 1;
                
                if (sentenceLength + sentLen > maxChunkSize && sentenceChunk.length > 0) {
                    chunks.push(sentenceChunk.join(' '));
                    sentenceChunk = [sentence];
                    sentenceLength = sentLen;
                } else {
                    sentenceChunk.push(sentence);
                    sentenceLength += sentLen;
                }
            }
            
            if (sentenceChunk.length > 0) {
                chunks.push(sentenceChunk.join(' '));
            }
            continue;
        }
        
        const paraLength = para.length + 2;
        
        if (currentLength + paraLength > maxChunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n\n'));
            currentChunk = [para];
            currentLength = paraLength;
        } else {
           currentChunk.push(para);
            currentLength += paraLength;
        }
    }
    
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
    }
    
    return chunks.map((chunk, index) => ({
        title: chunks.length > 1 ? `${title} Part ${index + 1}` : title,
        content: chunk
    }));
}

/**
 * Converts chapter content to ElevenLabs JSON format programmatically.
 */
function chapterToJson(chapterTitle, chapterContent, voiceId) {
    const blocks = [];
    
    blocks.push({
        sub_type: 'h2',
        nodes: [{
            voice_id: voiceId,
            text: chapterTitle,
            type: 'tts_node'
        }]
    });
    
    const paragraphs = chapterContent
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
    
    const contentStart = paragraphs[0] === chapterTitle ? 1 : 0;
    
    for (let i = contentStart; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        
        blocks.push({
            sub_type: 'p',
            nodes: [{
                voice_id: voiceId,
                text: paragraph,
                type: 'tts_node'
            }]
        });
    }
    
    return blocks;
}

// =============================================================================
// MANUSCRIPT UPDATE LOGIC
// =============================================================================

async function processManuscriptUpdate(ws, data) {
    try {
        const { gallery_id, file_id, studio_id, access_token, supabase_anon_key, eleven_labs_api_key, voice_id } = data;

        ws.send(JSON.stringify({ status: 'processing', message: 'Preparing manuscript update...' }));

        const SUPABASE_URL = "https://hskaqvjruqzmgrwxmxxd.supabase.co";

        // Fetch gallery and find specific file
        ws.send(JSON.stringify({ status: 'processing', message: 'Fetching file from storage...' }));
        
        const galleryResponse = await fetch(`${SUPABASE_URL}/rest/v1/galleries?id=eq.${gallery_id}&select=files`, {
            headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!galleryResponse.ok) {
            throw new Error(`Failed to fetch gallery: ${await galleryResponse.text()}`);
        }

        const galleryData = await galleryResponse.json();
        if (!galleryData || galleryData.length === 0) {
            throw new Error('Gallery not found');
        }

        const gallery = galleryData[0];
        const files = gallery.files || [];
        
        // Find the specific file by file_id
        const file = files.find(f => f.id === file_id);
        if (!file) {
            throw new Error(`File with id ${file_id} not found in gallery`);
        }

        const fileUrl = file.url;
        const fileExt = fileUrl.split('.').pop().split('?')[0].toLowerCase();
        const tempFilePath = path.join('/tmp', `manuscript_update_${Date.now()}.${fileExt}`);

        // Download file from URL
        await downloadFile(fileUrl, tempFilePath);

        ws.send(JSON.stringify({ status: 'processing', message: 'Processing manuscript...' }));
        
        let manuscriptText;
        let rawChapters;
        
        // Extract text/chapters based on file type
        if (fileExt === 'txt' || fileExt === 'text') {
            manuscriptText = fs.readFileSync(tempFilePath, 'utf8');
        } else if (fileExt === 'docx' || fileExt === 'doc') {
            const result = await mammoth.extractRawText({ path: tempFilePath });
            manuscriptText = result.value;
        } else if (fileExt === 'rtf') {
            manuscriptText = fs.readFileSync(tempFilePath, 'utf8');
        } else if (fileExt === 'pdf') {
            const dataBuffer = fs.readFileSync(tempFilePath);
            const pdfData = await pdfParse(dataBuffer);
            manuscriptText = pdfData.text;
        } else if (fileExt === 'epub') {
            const epub = new EPub(tempFilePath);
            await new Promise((resolve, reject) => {
                epub.on('end', resolve);
                epub.on('error', reject);
                epub.parse();
            });
            
            const epubChapters = epub.flow;
            rawChapters = [];
            
            for (const chapter of epubChapters) {
                const chapterText = await new Promise((resolve, reject) => {
                    epub.getChapterRaw(chapter.id, (error, text) => {
                        if (error) reject(error);
                        else {
                            const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                            resolve(stripped);
                        }
                    });
                });
                const title = chapter.title || `Chapter ${rawChapters.length + 1}`;
                rawChapters.push({ title: title, content: chapterText });
            }
            
            manuscriptText = null;
        } else {
            manuscriptText = fs.readFileSync(tempFilePath, 'utf8');
        }
        
        fs.unlinkSync(tempFilePath);

        // Extract chapters if not EPUB
        if (fileExt !== 'epub') {
            ws.send(JSON.stringify({ status: 'processing', message: 'Detecting chapters...' }));
            rawChapters = extractChaptersFromText(manuscriptText);
        }
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
        
        // Convert chapters to ElevenLabs format
        ws.send(JSON.stringify({ 
            status: 'processing', 
            message: `Processing ${chapters.length} new chapter(s)...` 
        }));
        
        const newChapterIds = [];
        
        // Add each chapter to ElevenLabs project
        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];
            ws.send(JSON.stringify({ 
                status: 'processing', 
                message: `Adding chapter ${i + 1}/${chapters.length} to project...` 
            }));
            
            console.log(`\n=== CHAPTER ${i + 1} DEBUG ===`);
            console.log(`Title: "${chapter.title}"`);
            console.log(`Content length: ${chapter.content.length} chars`);
            console.log(`Content preview: "${chapter.content.substring(0, 200)}..."`);
            
            const blocks = chapterToJson(chapter.title, chapter.content, voice_id);
            
            // Sanitize blocks: ensure sub_type exists
            if (Array.isArray(blocks)) {
                blocks.forEach((block, index) => {
                    if (!block.sub_type) {
                        // First block is typically the chapter title -> h2
                        block.sub_type = index === 0 ? 'h2' : 'p';
                    }
                });
            }
            
            console.log(`Blocks generated: ${blocks.length}`);
            console.log(`First block preview:`, JSON.stringify(blocks[0], null, 2));
            if (blocks.length > 1) {
                console.log(`Second block preview:`, JSON.stringify(blocks[1], null, 2));
            }
            
            // 1. Create blank chapter first
            const addChapterResponse = await fetch(`https://api.elevenlabs.io/v1/studio/projects/${studio_id}/chapters`, {
                method: 'POST',
                headers: {
                    'xi-api-key': eleven_labs_api_key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: chapter.title
                })
            });

            if (!addChapterResponse.ok) {
                const errorBody = await addChapterResponse.text();
                // If error is "Project has reached maximum number of chapters", handle gracefully? 
                // For now, throw error.
                console.error('ElevenLabs Add Chapter Error:', addChapterResponse.status, errorBody);
                throw new Error(`Failed to add chapter: ${addChapterResponse.status} - ${errorBody}`);
            }

            const chapterData = await addChapterResponse.json();
            // console.log('ElevenLabs Create Response:', JSON.stringify(chapterData, null, 2));
            
            const chapterId = chapterData.chapter ? chapterData.chapter.chapter_id : chapterData.chapter_id;
            
            if (!chapterId) {
                 console.error('CRITICAL: Could not find chapter_id in response', chapterData);
                 throw new Error('Failed to retrieve chapter_id from ElevenLabs response');
            }
            
            // 2. Update the chapter with content
            // Endpoint: POST /v1/studio/projects/{project_id}/chapters/{chapter_id}
            console.log(`Updating content for chapter ${chapterId}...`);
            
            const updateChapterResponse = await fetch(`https://api.elevenlabs.io/v1/studio/projects/${studio_id}/chapters/${chapterId}`, {
                method: 'POST',
                headers: {
                    'xi-api-key': eleven_labs_api_key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: {
                        blocks: blocks
                    }
                })
            });
            
            if (!updateChapterResponse.ok) {
                 const errorBody = await updateChapterResponse.text();
                 console.error('ElevenLabs Update Chapter Error:', updateChapterResponse.status, errorBody);
                 throw new Error(`Failed to update chapter content: ${updateChapterResponse.status} - ${errorBody}`);
            }

            // Only push ID if update succeeded
            newChapterIds.push(chapterId);
            
            console.log(`Chapter ${i + 1}/${chapters.length} added and updated: ${chapterId}`);
        }

        // Fetch existing studio record
        ws.send(JSON.stringify({ status: 'processing', message: 'Updating studio database...' }));
        
        const studioFetchResponse = await fetch(`${SUPABASE_URL}/rest/v1/studio?id=eq.${studio_id}`, {
            headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!studioFetchResponse.ok) {
            throw new Error(`Failed to fetch studio record: ${await studioFetchResponse.text()}`);
        }

        const studioData = await studioFetchResponse.json();
        if (!studioData || studioData.length === 0) {
            throw new Error('Studio record not found');
        }

        const existingStudio = studioData[0];
        const existingChapters = existingStudio.chapters || [];

        // Fetch details for new chapters from ElevenLabs
        const newChapterDetails = [];
        for (const chapterId of newChapterIds) {
            const contentResponse = await fetch(`https://api.elevenlabs.io/v1/studio/projects/${studio_id}/chapters/${chapterId}`, {
                method: 'GET',
                headers: { 'xi-api-key': eleven_labs_api_key }
            });

            if (contentResponse.ok) {
                const contentData = await contentResponse.json();
                newChapterDetails.push({
                    id: chapterId,
                    name: contentData.name || `Chapter ${newChapterDetails.length + 1}`,
                    content_json: contentData.content || {}
                });
            } else {
                console.warn(`Failed to fetch content for chapter ${chapterId}`);
            }
        }

        // Merge chapters
        const updatedChapters = [...existingChapters, ...newChapterDetails];

        // Update studio record
        const studioUpdateResponse = await fetch(`${SUPABASE_URL}/rest/v1/studio?id=eq.${studio_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabase_anon_key,
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                chapters: updatedChapters
            })
        });

        if (!studioUpdateResponse.ok) {
            throw new Error(`Failed to update studio: ${await studioUpdateResponse.text()}`);
        }

        ws.send(JSON.stringify({ 
            status: 'completed', 
            message: `Successfully added ${chapters.length} new chapter(s)!`, 
            data: {
                studio_id: studio_id,
                chapters_added: chapters.length,
                new_chapter_ids: newChapterIds,
                total_chapters: updatedChapters.length
            }
        }));

    } catch (error) {
        console.error('Manuscript update failed:', error);
        ws.send(JSON.stringify({ 
            status: 'error', 
            message: `Update failed: ${error.message}` 
        }));
    }
}

async function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            } else {
                // If it's a redirect, follow it
                if (response.statusCode === 302 || response.statusCode === 301) {
                    downloadFile(response.headers.location, destPath)
                        .then(resolve)
                        .catch(reject);
                } else {
                    fs.unlink(destPath, () => reject(new Error(`Server responded with ${response.statusCode}: ${response.statusMessage}`)));
                }
            }
        }).on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });
    });
}

server.listen(PORT, () => {
    console.log(`Manuscript Update Server running on port ${PORT}`);
});