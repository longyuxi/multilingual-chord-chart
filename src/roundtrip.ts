/**
 * Round-trip: tab → IR → tab. Usage: node dist/roundtrip.js <input.txt> [output.txt]
 */

import * as fs from 'fs';
import * as path from 'path';
import ChordSheetJS from 'chordsheetjs';
import { songToIr, irToSong } from './ir';

function main(): void {
  const inputPath = process.argv[2];
  let outputPath = process.argv[3];

  if (!inputPath) {
    console.error('Usage: node dist/roundtrip.js <input.txt> [output.txt]');
    process.exit(1);
  }

  const base = path.resolve(process.cwd(), inputPath);
  const content = fs.readFileSync(base, 'utf8');
  const parser = new (ChordSheetJS as unknown as { UltimateGuitarParser: new () => { parse: (s: string) => unknown } }).UltimateGuitarParser();
  const song = parser.parse(content) as Parameters<typeof songToIr>[0];
  const ir = songToIr(song);
  const song2 = irToSong(ir);
  const formatter = new (ChordSheetJS as unknown as { ChordsOverWordsFormatter: new () => { format: (s: unknown) => string } }).ChordsOverWordsFormatter();
  const tab = formatter.format(song2);

  if (!outputPath) {
    outputPath = base.replace(/\.(txt|text)$/i, '') + '.roundtrip.txt';
  } else {
    outputPath = path.resolve(process.cwd(), outputPath);
  }
  fs.writeFileSync(outputPath, tab, 'utf8');
  console.log('Wrote', outputPath);
}

main();
