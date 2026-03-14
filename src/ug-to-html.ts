/**
 * Convert an Ultimate Guitar chord sheet to an HTML file.
 * Usage: node dist/ug-to-html.js <input.txt> [output.html]
 */

import * as fs from 'fs';
import * as path from 'path';
import ChordSheetJS from 'chordsheetjs';

type AnyParser = { parse: (s: string) => unknown };
type AnyFormatter = { format: (song: unknown) => string };
const CS = ChordSheetJS as unknown as {
  UltimateGuitarParser: new () => AnyParser;
  HtmlDivFormatter: new () => AnyFormatter;
};

function main(): void {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  if (!inputPath) {
    console.error('Usage: node dist/ug-to-html.js <input.txt> [output.html]');
    process.exit(1);
  }

  const base = path.resolve(process.cwd(), inputPath);
  const content = fs.readFileSync(base, 'utf8');

  const parser = new CS.UltimateGuitarParser();
  const song = parser.parse(content);

  const formatter = new CS.HtmlDivFormatter();
  const html = formatter.format(song);

  const inputBase = path.basename(base, path.extname(base));
  const outputPath = args[1] ?? path.join(path.dirname(base), inputBase + '.html');

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log('Wrote', outputPath);
}

main();
