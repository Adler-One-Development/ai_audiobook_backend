import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const OPENAI_API_KEY = process.env.OPENAI_KEY;
const VOICE_ID = 'hpp4J3VqNfWAUOO0d1Us';

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
    
    const chapters = [];
    
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

async function main() {
    console.log('\n🤖 OPENAI CHAPTER-BY-CHAPTER EXTRACTION TEST');
    console.log('='.repeat(80));
    
    // Step 1: Extract manuscript text
    console.log('\n📄 Step 1: Extracting manuscript text...');
    const docxPath = path.join(__dirname, 'Manuscript_ The Cold Polar Bear.docx');
    
    if (!fs.existsSync(docxPath)) {
        console.error('❌ File not found!');
        return;
    }
    
    const result = await mammoth.extractRawText({ path: docxPath });
    const manuscriptText = result.value;
    console.log(`✅ Extracted ${manuscriptText.length} characters`);
    
    // Step 2: Extract chapters
    console.log('\n📚 Step 2: Extracting chapters...');
    const rawChapters = extractChaptersFromText(manuscriptText);
    console.log(`✅ Found ${rawChapters.length} chapter(s)`);
    
    // Step 2.5: Split long chapters into manageable parts
    console.log('\n✂️  Step 2.5: Checking for long chapters...');
    const chapters = [];
    for (const chapter of rawChapters) {
        const parts = splitLongChapter(chapter);
        if (parts.length > 1) {
            console.log(`   ⚠️  Split "${chapter.title}" into ${parts.length} parts (${chapter.content.length} chars)`);
        }
        chapters.push(...parts);
    }
    console.log(`✅ Total chapters after splitting: ${chapters.length}`);
    
    chapters.forEach((ch, idx) => {
        console.log(`   ${idx + 1}. ${ch.title} (${ch.content.length} chars)`);
    });
    
    // Step 3: Process each chapter with OpenAI
    console.log('\n☁️  Step 3: Processing chapters with OpenAI...\n');
    
    if (!OPENAI_API_KEY) {
        console.error('❌ OPENAI_KEY not set!');
        return;
    }
    
    const startTime = Date.now();
    const generatedContent = [];
    
    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        console.log(`   [${i + 1}/${chapters.length}] Processing: ${chapter.title}...`);
        
        try {
            const blocks = await processChapterWithOpenAI(
                chapter.content,
                chapter.title,
                VOICE_ID,
                OPENAI_API_KEY
            );
            
            generatedContent.push({
                name: chapter.title,
                blocks: blocks
            });
            
            console.log(`   ✅ Done (${blocks.length} blocks)\n`);
            
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}\n`);
        }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ All chapters processed in ${duration}s`);
    
    // Statistics
    console.log('\n' + '='.repeat(80));
    console.log('📈 STATISTICS');
    console.log('='.repeat(80));
    console.log(`Chapters: ${generatedContent.length}`);
    
    let totalBlocks = 0;
    let totalNodes = 0;
    
    generatedContent.forEach((chapter, idx) => {
        const blocks = chapter.blocks || [];
        totalBlocks += blocks.length;
        const nodes = blocks.reduce((sum, b) => sum + (b.nodes || []).length, 0);
        totalNodes += nodes;
        
        console.log(`\nChapter ${idx + 1}: "${chapter.name}"`);
        console.log(`  - Blocks: ${blocks.length}`);
        console.log(`  - Nodes: ${nodes}`);
    });
    
    console.log(`\n📊 Total: ${totalBlocks} blocks, ${totalNodes} nodes`);
    
    // Save output
    console.log('\n💾 Saving output...');
    const outputPath = path.join(__dirname, 'openai_output.json');
    fs.writeFileSync(outputPath, JSON.stringify(generatedContent, null, 2));
    console.log(`✅ Saved to: ${outputPath}`);
    
    // Sample
    console.log('\n' + '='.repeat(80));
    console.log('📝 SAMPLE (First Chapter)');
    console.log('='.repeat(80));
    console.log(JSON.stringify(generatedContent[0], null, 2).substring(0, 800) + '...');
    
    console.log('\n' + '='.repeat(80));
    console.log('🎉 TEST COMPLETE!\n');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
