/**
 * Read IR (JSON or LM text) and output Ultimate Guitar-style chord tab.
 * Usage: node dist/ir-to-tab.js <input.ir.json|input.ir.lm.txt> [output.txt]
 */

import * as fs from 'fs';
import * as path from 'path';
import ChordSheetJS from 'chordsheetjs';
import { irToSong, lmTextToIr } from './ir';
import type { Ir } from './types/ir';

function loadIr(inputPath: string): Ir {
  const content = fs.readFileSync(path.resolve(process.cwd(), inputPath), 'utf8');
  if (inputPath.endsWith('.json') || content.trimStart().startsWith('{')) {
    return JSON.parse(content) as Ir;
  }
  return lmTextToIr(content);
}

function main(): void {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    console.error('Usage: node dist/ir-to-tab.js <input.ir.json|input.ir.lm.txt> [output.txt]');
    process.exit(1);
  }

  const ir = loadIr(inputPath);
  const song = irToSong(ir);
  const formatter = new (ChordSheetJS as unknown as { ChordsOverWordsFormatter: new () => { format: (s: unknown) => string } }).ChordsOverWordsFormatter();
  const tab = formatter.format(song);

  if (outputPath) {
    fs.writeFileSync(path.resolve(process.cwd(), outputPath), tab, 'utf8');
    console.log('Wrote', outputPath);
  } else {
    const base = path.resolve(process.cwd(), inputPath);
    const outPath = base
      .replace(/\.ir\.lm\.txt$/i, '.txt')
      .replace(/\.ir\.json$/i, '.txt')
      .replace(/\.json$/i, '.txt');
    if (outPath !== base) {
      fs.writeFileSync(outPath, tab, 'utf8');
      console.log('Wrote', outPath);
    } else {
      process.stdout.write(tab);
    }
  }
}

main();
