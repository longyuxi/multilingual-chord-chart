/**
 * Parse an Ultimate Guitar chord tab file and output the IR (JSON and/or LM text).
 * Usage: node dist/tab-to-ir.js <input.txt> [output.ir.json] [--pinyin]
 *
 * --pinyin  Treat the parsed line text as pinyin (IR pinyin field); lyrics stay empty.
 *           Default: line text goes into lyrics.
 */

import * as fs from 'fs';
import * as path from 'path';
import ChordSheetJS from 'chordsheetjs';
import { songToIr } from './ir';
import type { Ir } from './types/ir';

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '');
  const textAsPinyin = args.includes('--pinyin');
  const bothPinyinAndLyrics = args.includes('--both');
  const rest = args.filter((a) => a !== '--pinyin' && a !== '--both');
  const inputPath = rest[0];
  let outputPath = rest[1];

  if (!inputPath) {
    console.error('Usage: node dist/tab-to-ir.js <input.txt> [output.ir.json] [--lm] [--pinyin]');
    process.exit(1);
  }

  const base = path.resolve(process.cwd(), inputPath);
  const content = fs.readFileSync(base, 'utf8');
  const parser = new (ChordSheetJS as unknown as { UltimateGuitarParser: new () => { parse: (s: string) => unknown } }).UltimateGuitarParser();
  const song = parser.parse(content) as Parameters<typeof songToIr>[0];
  const ir: Ir = songToIr(song, { textAsPinyin, bothPinyinAndLyrics, rawTabContent: content });

  const outDir = path.dirname(base);
  const inputBase = path.basename(base, path.extname(base));
  if (!outputPath) {
    outputPath = path.join(outDir, inputBase + '.ir.json');
  }
  fs.writeFileSync(outputPath, JSON.stringify(ir, null, 2), 'utf8');
  console.log('Wrote', outputPath);
}

main();
