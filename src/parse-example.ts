/**
 * ChordSheetJS parse example
 * - Parses the classic Ultimate Guitar format (chords over words)
 * - Then attempts to parse convert/fcml-out.txt
 *
 * Docs: https://martijnversluis.github.io/ChordSheetJS/
 */

import ChordSheetJS from 'chordsheetjs';
import * as fs from 'fs';
import * as path from 'path';

interface ParsedSong {
  bodyParagraphs: Array<{
    type: string;
    lines: Array<{ items: Array<{ chords?: string; lyrics?: string }> }>;
  }>;
}

const Parser = (ChordSheetJS as unknown as { UltimateGuitarParser: new () => { parse: (s: string) => ParsedSong } }).UltimateGuitarParser;
const TextFormatter = (ChordSheetJS as unknown as { TextFormatter: new () => { format: (song: ParsedSong) => string } }).TextFormatter;

const parser = new Parser();
const textFormatter = new TextFormatter();

// --- 1. Parse the documentation example (Ultimate Guitar format) ---
const chordSheetExample = `
[Chorus]
       Am         C/G        F          C
Let it be, let it be, let it be, let it be
C                G              F  C/E Dm C
Whisper words of wisdom, let it be`.substring(1);

const songFromExample = parser.parse(chordSheetExample);

console.log('=== Parsed (documentation example) ===');
console.log('Body paragraphs:', songFromExample.bodyParagraphs.length);
songFromExample.bodyParagraphs.forEach((paragraph, i) => {
  console.log(`\nParagraph ${i + 1} (type: ${paragraph.type}):`);
  paragraph.lines.forEach((line) => {
    const chordPart = line.items.map((item) => (item.chords != null ? item.chords : '')).join(' ').trim();
    const lyricPart = line.items.map((item) => (item.lyrics != null ? item.lyrics : '')).join('').trim();
    if (chordPart) console.log('  Chords:', chordPart);
    if (lyricPart) console.log('  Lyrics:', lyricPart);
  });
});

console.log('\n=== As plain text ===');
console.log(textFormatter.format(songFromExample));

// --- 2. Parse fcml-out.txt (Ultimate Guitar style from your file) ---
const fcmlPath = path.join(process.cwd(), 'convert', 'fcml-out.txt');
const fcmlContent = fs.readFileSync(fcmlPath, 'utf8');

console.log('\n\n=== Parsing convert/fcml-out.txt ===');
const songFromFile = parser.parse(fcmlContent);

console.log('Body paragraphs:', songFromFile.bodyParagraphs.length);
songFromFile.bodyParagraphs.forEach((paragraph, i) => {
  console.log(`\nParagraph ${i + 1} (type: ${paragraph.type}):`);
  paragraph.lines.forEach((line) => {
    const chordPart = line.items.map((item) => (item.chords != null ? item.chords : '')).join(' ').trim();
    const lyricPart = line.items.map((item) => (item.lyrics != null ? item.lyrics : '')).join('').trim();
    if (chordPart) console.log('  Chords:', chordPart);
    if (lyricPart) console.log('  Lyrics:', lyricPart);
  });
});

console.log('\n=== fcml-out.txt as plain text ===');
console.log(textFormatter.format(songFromFile));
