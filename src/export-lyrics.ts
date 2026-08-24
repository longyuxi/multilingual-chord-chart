import * as fs from 'fs';
import * as path from 'path';

type Segment = { chord: string; lyrics: string[] };

function parseLanguages(raw: string): string[] {
  for (const line of raw.split('\n')) {
    const m = line.match(/^%%languages\s+(.+)/);
    if (m) return m[1].split(',').map(s => s.trim());
  }
  return ['lyrics'];
}

function parseLyricLines(raw: string, numLanguages: number): Segment[][] {
  const lines: Segment[][] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('%') || line.startsWith('>') || /^<.+>$/.test(line)) continue;
    if (!line.includes('[')) continue;

    const segments: Segment[] = [];
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
