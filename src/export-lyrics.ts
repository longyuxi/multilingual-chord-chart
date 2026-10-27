// Exports one song's lyrics as plain text, one block per `%%languages` track. How a line
// splits into segments -- the chordless run before the first bracket, and inline `@M:SS`
// markers stripped out of the text -- is the grammar `song-audit.ts` and the timestamp
// pipeline already use (`timestamps/check.ts`, `timestamps/normalize.ts`,
// `ecb-syllable-matcher.ts`). Keeping it in step is deliberate, so a line exports exactly
// the syllables it has (tab-pinyinizer-i8v.7).

import * as fs from 'fs';
import * as path from 'path';

type Segment = { chord: string; lyrics: string[] };

/** `@45`, `@1:30`, `@1:02:03`: timed text, never part of the lyric. */
const MARKER_RE = /@\d+(?::\d+){0,2}/g;

function parseLanguages(raw: string): string[] {
  for (const line of raw.split('\n')) {
    const m = line.match(/^%%languages\s+(.+)/);
    if (m) return m[1].split(',').map(s => s.trim());
  }
  return ['lyrics'];
}

function parseLyricLines(raw: string, numLanguages: number): Segment[][] {
  const lines: Segment[][] = [];
  for (const sourceLine of raw.split('\n')) {
    const line = sourceLine.replace(MARKER_RE, '');
    if (line.startsWith('%') || line.startsWith('>') || /^<.+>$/.test(line)) continue;
    if (!line.includes('[')) continue;

    const segments: Segment[] = [];
    // Text before the first bracket is a chordless segment, the way every other ECB
    // parser in the repo reads a line (`src/ecb-syllable-matcher.ts`,
    // `src/timestamps/check.ts`, `src/web/ecb-viewer-parser.ts`) -- dropping it would
    // export a line without its first syllables (tab-pinyinizer-i8v.7).
    const leadingText = line.slice(0, line.indexOf('[')).trim();
    if (leadingText !== '') {
      segments.push({ chord: '', lyrics: leadingText.split('|').map(s => s.trim()) });
    }
    const re = /\[([^\]]*)\]([^\[]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const chord = match[1].trim();
      const textPart = match[2].trim();
      const lyrics = textPart === ''
        ? Array(numLanguages).fill('')
        : textPart.split('|').map(s => s.trim());
      segments.push({ chord, lyrics });
    }
    if (segments.some(s => s.lyrics.some(l => l !== ''))) {
      lines.push(segments);
    }
  }
  return lines;
}

function exportLyrics(ecbPath: string, outPath: string): void {
  const raw = fs.readFileSync(ecbPath, 'utf-8');
  const languages = parseLanguages(raw);
  const lyricLines = parseLyricLines(raw, languages.length);

  const blocks = languages.map((lang, i) => {
    const text = lyricLines
      .map(segments =>
        segments
          .map(seg => seg.lyrics[i] ?? '')
          .filter(l => l !== '')
          .join(' ')
      )
      .filter(l => l !== '')
      .join('\n');
    return `${lang}\n${text}`;
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, blocks.join('\n\n') + '\n');
  console.log(`Wrote ${outPath}`);
}

const [, , inputArg, outputArg] = process.argv;
if (!inputArg) {
  console.error('Usage: export-lyrics <song.ecb> [output.txt]');
  process.exit(1);
}

const outPath = outputArg ?? path.join(
  'convert_workdir',
  `${path.basename(inputArg, path.extname(inputArg))}_lyrics.txt`
);

exportLyrics(inputArg, outPath);
