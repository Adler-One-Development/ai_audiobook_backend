import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Test with different formats
const testCases = [
    {
        name: 'Chapter Format',
        text: 'Chapter 1: Introduction\nSome text here.\n\nChapter 2: Main Story\nMore content.\n\nChapter 3: Conclusion\nThe end.'
    },
    {
        name: 'Part Format',
        text: 'Part 1: Setup\nFirst part content.\n\nPart 2: Development\nSecond part.\n\nPart 3: Resolution\nFinal part.'
    },
    {
        name: 'Generic Heading',
       text: 'Introduction:\nOpening paragraph.\n\nMain Theme:\nCore content.\n\nConclusion:\nClosing thoughts.'
    },
    {
        name: 'No Structure',
        text: 'This is a manuscript with no clear structure. It just flows continuously as one piece of text without any chapter markers or headings.'
    }
];

console.log('\n📝 FLEXIBLE CHAPTER EXTRACTION TEST');
console.log('='.repeat(80));

testCases.forEach((testCase, idx) => {
    console.log(`\n${idx + 1}. ${testCase.name}:`);
    const result = extractChaptersFromText(testCase.text);
    console.log(`   ✅ Found ${result.length} section(s):`);
    result.forEach((ch, i) => {
        console.log(`      ${i + 1}. "${ch.title}" (${ch.content.length} chars)`);
    });
});

console.log('\n' + '='.repeat(80));
console.log('✅ All tests completed!\n');
