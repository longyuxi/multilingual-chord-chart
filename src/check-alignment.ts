/**
 * Check if ChordSheetJS preserves chord-to-lyric alignment when parsing
 * jrayty-in.txt (Ultimate Guitar format: chord line above lyric line).
 *
 * Verse 1 first couplet:
 *   Am        G          C        C
 *   dang tian bian na ke xing chu xian
 *
 * We want to see: Am->"dang ", G->"tian bian ", C->"na ke ", etc.
 */

import ChordSheetJS from 'chordsheetjs';
import * as fs from 'fs';
import * as path from 'path';

const parser = new (ChordSheetJS as unknown as { UltimateGuitarParser: new () => { parse: (s: string) => ParsedSong } }).UltimateGuitarParser();
const content = fs.readFileSync(path.join(process.cwd(), 'convert', 'jrayty-in.txt'), 'utf8');
const song = parser.parse(content);

interface ParsedSong {
  bodyParagraphs: Array<{
    type: string;
    lines: Array<{ items: Array<{ chords?: string; lyrics?: string }> }>;
  }>;
}

let found = false;
for (const para of song.bodyParagraphs) {
  if (para.type !== 'verse') continue;
  console.log('=== First Verse (chord ↔ lyric alignment) ===\n');
  for (const line of para.lines.slice(0, 4)) {
    if (!line.items.some((item) => item.chords != null || item.lyrics != null)) continue;
    console.log('Line items (each pair = chord above its lyrics):');
    line.items.forEach((item, i) => {
      const c = (item.chords != null ? item.chords : '').trim() || '(space)';
      const l = (item.lyrics != null ? item.lyrics : '').trim() || '(none)';
      if (c !== '(space)' || l !== '(none)') console.log(`  ${i + 1}. chords: ${JSON.stringify(c)}  →  lyrics: ${JSON.stringify(l)}`);
    });
    console.log('');
  }
  found = true;
  break;
}
if (!found) console.log('No verse paragraph found.');
