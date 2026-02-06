import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import epubPkg from 'epub2';
const EPub = epubPkg.EPub || epubPkg.default || epubPkg;
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extracts sections from manuscript text using flexible pattern matching.
 */
function extractChaptersFromText(text) {
    const patterns = [
        /(?=^(?:Chapter|CHAPTER)\\s+\\d+)/gim,
        /(?=^(?:Part|PART)\\s+\\d+)/gim,
        /(?=^(?:Section|SECTION)\\s+\\d+)/gim,
        /(?=^(?:Book|BOOK)\\s+\\d+)/gim,
        /(?=^[A-Z][A-Za-z\\s]{0,50}:)/gm
    ];
    
    const chapters = [];
    
    for (const pattern of patterns) {
        const parts = text.split(pattern).filter(p => p.trim().length > 0);
        
        if (parts.length > 1) {
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.length > 0) {
                    const firstLineEnd = trimmed.indexOf('\\n');
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
 * Extracts text and chapters from file.
 * For EPUB files, returns native chapter structure.
 * For other files, extracts text and then detects chapters.
 */
async function extractChaptersFromFile(filePath) {
    const fileExt = path.extname(filePath).toLowerCase().substring(1);
    
    // Special handling for EPUB - use native chapter structure
    if (fileExt === 'epub') {
        const epub = new EPub(filePath);
        
        await new Promise((resolve, reject) => {
            epub.on('end', resolve);
            epub.on('error', reject);
            epub.parse();
        });

        const epubChapters = epub.flow;
        const chapters = [];

        for (const chapter of epubChapters) {
            const chapterText = await new Promise((resolve, reject) => {
                epub.getChapterRaw(chapter.id, (error, text) => {
                    if (error) reject(error);
                    else {
                        // Strip HTML tags
                        const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
                        resolve(stripped);
                    }
                });
            });
            
            // Use the chapter title from EPUB metadata, or extract from content
            const title = chapter.title || `Chapter ${chapters.length + 1}`;
            
            chapters.push({
                title: title,
                content: chapterText
            });
        }

        return chapters;
    }
    
    // For non-EPUB files, extract text and then detect chapters
    let extractedText = '';

    if (fileExt === 'txt' || fileExt === 'text') {
        extractedText = fs.readFileSync(filePath, 'utf8');
    } else if (fileExt === 'docx' || fileExt === 'doc') {
        const result = await mammoth.extractRawText({ path: filePath });
        extractedText = result.value;
    } else if (fileExt === 'rtf') {
        extractedText = fs.readFileSync(filePath, 'utf8');
    } else if (fileExt === 'pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        extractedText = pdfData.text;
    } else {
        extractedText = fs.readFileSync(filePath, 'utf8');
    }
    
    return extractChaptersFromText(extractedText);
}

// Test with actual files
console.log('\\n📚 ENHANCED CHAPTER EXTRACTION TEST');
console.log('='.repeat(80));

const testDir = __dirname;
const files = fs.readdirSync(testDir);

const testFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.txt', '.text', '.docx', '.doc', '.rtf', '.pdf', '.epub'].includes(ext);
});

if (testFiles.length === 0) {
    console.log('❌ No files found to test!');
} else {
    for (const file of testFiles) {
        console.log(`\\n${'─'.repeat(80)}`);
        console.log(`📄 File: ${file}`);
        const fileExt = path.extname(file).toLowerCase().substring(1);
        console.log(`📋 Format: ${fileExt.toUpperCase()}`);
        console.log(`${'─'.repeat(80)}`);
        
        try {
            const filePath = path.join(testDir, file);
            const chapters = await extractChaptersFromFile(filePath);
            
            console.log(`✅ Found ${chapters.length} chapter(s):\\n`);
            
            // Show first 10 chapters
            const displayCount = Math.min(chapters.length, 10);
            for (let i = 0; i < displayCount; i++) {
                const ch = chapters[i];
                const preview = ch.content.substring(0, 60).replace(/\\n/g, ' ');
                console.log(`   ${i + 1}. "${ch.title}"`);
                console.log(`      Length: ${ch.content.length.toLocaleString()} chars`);
                console.log(`      Preview: ${preview}...\\n`);
            }
            
            if (chapters.length > 10) {
                console.log(`   ... and ${chapters.length - 10} more chapters\\n`);
            }
            
            const totalChars = chapters.reduce((sum, ch) => sum + ch.content.length, 0);
            console.log(`📊 Total content: ${totalChars.toLocaleString()} characters`);
            
        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }
    }
}

console.log('\\n' + '='.repeat(80));
console.log('✅ Test completed!\\n');
