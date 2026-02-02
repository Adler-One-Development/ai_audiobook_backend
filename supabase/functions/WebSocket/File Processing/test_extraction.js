import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import EPub from 'epub2';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractTextFromFile(filePath) {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(filePath).toLowerCase().substring(1);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📄 Processing: ${fileName}`);
    console.log(`📋 Format: ${fileExt.toUpperCase()}`);
    console.log(`${'='.repeat(80)}\n`);

    try {
        let extractedText = '';

        if (fileExt === 'txt' || fileExt === 'text') {
            console.log('✓ Reading as plain text...');
            extractedText = fs.readFileSync(filePath, 'utf8');
        } 
        else if (fileExt === 'docx' || fileExt === 'doc') {
            console.log('✓ Extracting from DOCX/DOC using mammoth...');
            const result = await mammoth.extractRawText({ path: filePath });
            extractedText = result.value;
        } 
        else if (fileExt === 'rtf') {
            console.log('✓ Reading RTF as text...');
            extractedText = fs.readFileSync(filePath, 'utf8');
        } 
        else if (fileExt === 'pdf') {
            console.log('✓ Extracting from PDF using pdf-parse...');
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdfParse(dataBuffer);
            extractedText = pdfData.text;
        } 
        else if (fileExt === 'epub') {
            console.log('✓ Extracting from EPUB using epub2...');
            const epub = new EPub(filePath);
            
            await new Promise((resolve, reject) => {
                epub.on('end', resolve);
                epub.on('error', reject);
                epub.parse();
            });

            const chapters = epub.flow;
            const chapterTexts = [];

            for (const chapter of chapters) {
                const chapterText = await new Promise((resolve, reject) => {
                    epub.getChapterRaw(chapter.id, (error, text) => {
                        if (error) reject(error);
                        else {
                            const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                            resolve(stripped);
                        }
                    });
                });
                chapterTexts.push(chapterText);
            }

            extractedText = chapterTexts.join('\n\n');
        } 
        else {
            throw new Error(`Unsupported file format: ${fileExt}`);
        }

        console.log('✅ SUCCESS! Text extracted successfully\n');
        console.log('📊 Statistics:');
        console.log(`   - Total characters: ${extractedText.length}`);
        console.log(`   - Total words: ${extractedText.split(/\s+/).filter(w => w.length > 0).length}`);
        console.log(`   - Total lines: ${extractedText.split('\n').length}`);
        
        console.log('\n📝 Preview (first 500 characters):');
        console.log(`${'─'.repeat(80)}`);
        console.log(extractedText.substring(0, 500).trim() + '...');
        console.log(`${'─'.repeat(80)}`);

        return {
            success: true,
            fileName,
            fileType: fileExt,
            text: extractedText,
            stats: {
                characters: extractedText.length,
                words: extractedText.split(/\s+/).filter(w => w.length > 0).length,
                lines: extractedText.split('\n').length
            }
        };

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('Stack trace:', error.stack);
        
        return {
            success: false,
            fileName,
            fileType: fileExt,
            error: error.message
        };
    }
}

async function processAllFiles() {
    const testDir = __dirname;
    const files = fs.readdirSync(testDir);
    
    const testFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.txt', '.text', '.docx', '.doc', '.rtf', '.pdf', '.epub'].includes(ext);
    });

    if (testFiles.length === 0) {
        console.log('❌ No supported files found in directory!');
        console.log(`   Looked in: ${testDir}`);
        console.log('   Supported formats: TXT, TEXT, DOCX, DOC, RTF, PDF, EPUB');
        return;
    }

    console.log('\n🚀 FILE EXTRACTION TEST');
    console.log(`📁 Directory: ${testDir}`);
    console.log(`📦 Found ${testFiles.length} file(s) to process\n`);

    const results = [];
    
    for (const file of testFiles) {
        const filePath = path.join(testDir, file);
        const result = await extractTextFromFile(filePath);
        results.push(result);
    }

    // Summary
    console.log('\n\n');
    console.log('='.repeat(80));
    console.log('📊 EXTRACTION SUMMARY');
    console.log('='.repeat(80));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
    if (successful.length > 0) {
        successful.forEach(r => {
            console.log(`   ✓ ${r.fileName} (${r.fileType}) - ${r.stats.characters} chars, ${r.stats.words} words`);
        });
    }

    if (failed.length > 0) {
        console.log(`\n❌ Failed: ${failed.length}/${results.length}`);
        failed.forEach(r => {
            console.log(`   ✗ ${r.fileName} (${r.fileType}) - ${r.error}`);
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n${successful.length === results.length ? '🎉 All tests passed!' : '⚠️  Some tests failed'}\n`);
}

// Run the test
processAllFiles().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
