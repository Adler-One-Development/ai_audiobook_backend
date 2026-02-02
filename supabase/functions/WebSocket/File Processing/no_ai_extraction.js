import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOICE_ID = 'hpp4J3VqNfWAUOO0d1Us';

/**
 * Extracts sections from manuscript text using flexible pattern matching.
 * Supports: "Chapter X", "Part X", "Section X", or any heading-like pattern.
 * If no structure found, treats entire text as one section.
 */
function extractChaptersFromText(text) {
    const patterns = [
        /(?=^(?:Chapter|CHAPTER)\s+\d+)/gim,
        /(?=^(?:Part|PART)\s+\d+)/gim,
        /(?=^(?:Section|SECTION)\s+\d+)/gim,
        /(?=^(?:Book|BOOK)\s+\d+)/gim,
        /(?=^[A-Z][A-Za-z\s]{0,50}:)/gm
    ];
    
    const chapters = [];
    
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
 */
function splitLongChapter(chapter, maxChunkSize = 2500) {
    const { title, content } = chapter;
    
    if (content.length <= maxChunkSize) {
        return [chapter];
    }
    
    const paragraphs = content.split(/\n\n+/);
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;
    
    for (const para of paragraphs) {
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
 * Splits a paragraph containing dialogue into separate nodes.
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

async function main() {
    console.log('\n🔧 NO-AI EXTRACTION TEST (Programmatic JSON Generation)');
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
    
    // Step 3: Split long chapters
    console.log('\n✂️  Step 3: Checking for long chapters...');
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
    
    // Step 4: Generate JSON programmatically
    console.log('\n🔨 Step 4: Generating JSON structure programmatically...\n');
    
    const startTime = Date.now();
    const generatedContent = [];
    
    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        console.log(`   [${i + 1}/${chapters.length}] Processing: ${chapter.title}...`);
        
        const blocks = chapterToJson(chapter.title, chapter.content, VOICE_ID);
        
        generatedContent.push({
            name: chapter.title,
            blocks: blocks
        });
        
        console.log(`   ✅ Done (${blocks.length} blocks)\n`);
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
    const outputPath = path.join(__dirname, 'no_ai_output.json');
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
