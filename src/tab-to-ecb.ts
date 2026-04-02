/**
 * Convert an Ultimate Guitar chord tab file to ECB (Extended Chord Bracket) format.
 * Usage: node dist/tab-to-ecb.js <input.txt> [output.ecb] [--pinyin] [--both]
 *
 * --pinyin  Treat the tab's lyric text as pinyin (IR pinyin field); lyrics stay empty.
 * --both    Parse both pinyin and Chinese simultaneously (chord+pinyin paired by ChordSheetJS,
 *           following CJK-only line distributed as lyrics across segments).
 *           Default: line text goes into lyrics.
 */

import * as fs from 'fs';
import * as path from 'path';
import ChordSheetJS from 'chordsheetjs';
import { songToIr } from './ir';
import { irToEcb } from './ir-to-ecb';

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '');
  const textAsPinyin = args.includes('--pinyin');
  const bothPinyinAndLyrics = args.includes('--both');
  const rest = args.filter((a) => a !== '--pinyin' && a !== '--both');
  const inputPath = rest[0];
  let outputPath = rest[1];

  if (!inputPath) {
    console.error('Usage: node dist/tab-to-ecb.js <input.txt> [output.ecb] [--pinyin] [--both]');
    process.exit(1);
  }

  const base = path.resolve(process.cwd(), inputPath);
  const content = fs.readFileSync(base, 'utf8');

  const parser = new (ChordSheetJS as unknown as {
    UltimateGuitarParser: new () => { parse: (s: string) => unknown };
  }).UltimateGuitarParser();
  const song = parser.parse(content) as Parameters<typeof songToIr>[0];
  const ir = songToIr(song, { textAsPinyin, bothPinyinAndLyrics, rawTabContent: content });

  const ecb = irToEcb(ir);

  const outDir = path.dirname(base);
  const inputBase = path.basename(base, path.extname(base));
  if (!outputPath) {
    outputPath = path.join(outDir, inputBase + '.ecb');
  }

  fs.writeFileSync(outputPath, ecb, 'utf8');
  console.log('Wrote', outputPath);
}

main();
