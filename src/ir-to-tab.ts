/**
 * Read IR (JSON) and output Ultimate Guitar-style chord tab.
 * Usage: node dist/ir-to-tab.js <input.ir.json> [output.txt]
 * Uses in-house formatter so chords align with lyrics/pinyin (CJK = 2 cols, Latin = 1).
 */

import * as fs from 'fs';
import * as path from 'path';
import { irToTabString } from './ir-formatter';
import type { Ir } from './types/ir';

function loadIr(inputPath: string): Ir {
  const content = fs.readFileSync(path.resolve(process.cwd(), inputPath), 'utf8');
  return JSON.parse(content) as Ir;
}

function main(): void {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    console.error('Usage: node dist/ir-to-tab.js <input.ir.json> [output.txt]');
    process.exit(1);
  }

  const ir = loadIr(inputPath);
  const tab = irToTabString(ir);

  if (outputPath) {
    fs.writeFileSync(path.resolve(process.cwd(), outputPath), tab, 'utf8');
    console.log('Wrote', outputPath);
  } else {
    const base = path.resolve(process.cwd(), inputPath);
    const outPath = base
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
