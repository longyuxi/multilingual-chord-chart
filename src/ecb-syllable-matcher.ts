/**
 * ecb-syllable-matcher — deterministically re-segment translated English text so it
 * lines up with an existing .ecb file's chord/lyric segment structure.
 *
 * Usage:
 *   npm run build:cli
 *   node dist/ecb-syllable-matcher.js <input.json>
 *
 * The script only READS the .ecb file. It never writes to it — applying the result is
 * the calling agent's job.
 *
 * ---------------------------------------------------------------------------
 * INPUT JSON
 * ---------------------------------------------------------------------------
 * {
 *   "ecbFilePath": "songs/legend.ecb",   // required; relative paths resolve against cwd
 *   "startLine": 24,                     // required; 1-indexed, inclusive
 *   "endLine": 29,                       // required; 1-indexed, inclusive
 *   "chineseLanguageIndex": 0,           // optional, default 0
 *   "lyricToolsDir": "/abs/path",        // optional, default "~/workdir/lyric-translator-tools"
 *   "debug": false,                      // optional; when true, dump per-row sub-chunks to stderr
 *   "rows": [
 *     { "originalChinese": "宁愿用这一生等你发现",
 *       "translatedText": "I'd rather spend my life waiting to be found" }
 *   ]
 * }
 *
 * `rows` must already be in the exact target script (simplified Chinese here). This
 * script performs NO traditional->simplified conversion and NO fuzzy matching: if the
 * concatenated row Chinese does not match the concatenated ECB Chinese character for
 * character (all whitespace stripped from both), it exits non-zero with the mismatch
 * position and surrounding context.
 *
 * ---------------------------------------------------------------------------
 * OUTPUT JSON (stdout)
 * ---------------------------------------------------------------------------
 * {
 *   "segments": [
 *     { "lineNumber": 27, "segmentIndex": 0,
 *       "chinese": "宁愿用这一生等你",
 *       "newText": "I'd rather spend my life waiting" }
 *   ],
 *   "warnings": []
 * }
 *
 * `lineNumber` is the 1-indexed source line, `segmentIndex` is the 0-indexed position of
 * the segment within that line (counting chord-only segments too, so it indexes straight
 * into the line's segment list). `chinese` is the whitespace-stripped Chinese of that
 * segment (for sanity checking). `newText` is the text to place into the target language
 * slot of that segment — where in the `lang1|lang2|...` array that goes is the caller's
 * decision.
 *
 * ---------------------------------------------------------------------------
 * HOW SYLLABLES ARE DISTRIBUTED
 * ---------------------------------------------------------------------------
 * Each row is split into "sub-chunks", one per (possibly partial) segment its Chinese
 * span covers, each with a target = the number of Chinese characters it covers. The
 * row's syllables are then handed out front to back:
 *   - every sub-chunk but the last takes syllables up to (never over) its target; a word
 *     cut mid-way leaves a hyphenated head ("wait-") and continues bare ("ing") in the
 *     next sub-chunk;
 *   - the row's LAST sub-chunk absorbs everything left over, so over/underflow is
 *     absorbed per row and never leaks into the next row;
 *   - running out of syllables early produces a warning, never a crash.
 *
 * Note on syllable counting: `word_breakdown[i].count` is authoritative, but the flat
 * `syllables` array sometimes cannot split a word ("rather" and "away" both report
 * count 2 yet yield a single entry). Each flat entry therefore carries a weight, and a
 * chunk boundary never lands inside an unsplittable multi-syllable entry.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { EcbSegment } from './web/ecb-viewer-parser';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

interface InputRow {
  originalChinese: string;
  translatedText: string;
}

interface Input {
  ecbFilePath: string;
  startLine: number;
  endLine: number;
  chineseLanguageIndex?: number;
  lyricToolsDir?: string;
  debug?: boolean;
  rows: InputRow[];
}

interface OutputSegment {
  lineNumber: number;
  segmentIndex: number;
  chinese: string;
  newText: string;
}

interface Output {
  segments: OutputSegment[];
  warnings: string[];
}

/** A lyric segment located at an exact place in the source file. */
interface LocatedSegment extends EcbSegment {
  lineNumber: number;
  segmentIndex: number;
  /** Chinese lyric with all whitespace stripped. */
  chinese: string;
  /** Character range [start, end) in the concatenated stripped-Chinese coordinate space. */
  start: number;
  end: number;
}

/** One syllable as reported by the lyric-translator-tools CLI. */
interface Syllable {
  word_index: number;
  word: string;
  syllable: string;
  syllable_index: number;
  is_last_in_word: boolean;
}

interface WordBreakdown {
  word: string;
  syllables: string[];
  count: number;
}

interface SyllableToolOutput {
  original: string;
  total_syllables: number;
  word_breakdown: WordBreakdown[];
  syllables: Syllable[];
}

/**
 * A syllable entry plus how many syllables it actually counts for.
 *
 * The tool's hyphenation dictionary cannot always split a word: "rather" and "away" are
 * each reported with `count: 2` in `word_breakdown` but produce a single entry in the
 * flat `syllables` array. Weighting each entry keeps the syllable budget honest while
 * still using the flat list for the split points that do exist.
 */
interface WeightedSyllable extends Syllable {
  weight: number;
}

/** A slice of one row's translation destined for one (possibly partial) segment. */
interface SubChunk {
  segment: LocatedSegment;
  /** How many stripped Chinese characters of that segment this row covers. */
  targetCharCount: number;
  text: string;
}

const DEFAULT_LYRIC_TOOLS_DIR = '~/workdir/lyric-translator-tools';

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Strip ALL whitespace (ASCII + ideographic space), not just leading/trailing. */
function stripWhitespace(s: string): string {
  return s.replace(/[\s　]+/g, '');
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ---------------------------------------------------------------------------
// Line-numbered segment extraction
// ---------------------------------------------------------------------------

/**
 * Extract lyric segments with their exact source line numbers.
 *
 * This deliberately duplicates the `[chord]lyrics` regex from
 * `src/web/ecb-viewer-parser.ts#parseEcbBlocks` instead of calling it: that function
 * merges consecutive `%%` lines into a single `config_table` block, which destroys the
 * 1:1 block-to-source-line mapping this script needs.
 */
function extractSegments(
  lines: string[],
  startLine: number,
  endLine: number,
  numLanguages: number,
  chineseLanguageIndex: number,
): LocatedSegment[] {
  const out: LocatedSegment[] = [];
  let cursor = 0;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const line = lines[lineNumber - 1];
    if (line === undefined) fail(`startLine/endLine out of range: file has ${lines.length} lines, asked for line ${lineNumber}`);
    if (line.startsWith('%')) continue;
    if (line.trim() === '') continue;
    if (line.startsWith('> ')) continue;
    if (/^<(.+)>$/.test(line)) continue;
    if (!line.includes('[')) continue;

    const raw: EcbSegment[] = [];

    // Leading text before the first chord bracket is its own (chordless) segment.
    const firstBracket = line.indexOf('[');
    const leadingText = line.slice(0, firstBracket);
    if (leadingText.trim() !== '') {
      raw.push({ chord: '', lyrics: leadingText.trim().split('|').map((s) => s.trim()) });
    }

    const re = /\[([^\]]*)\]([^\[]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const textPart = match[2];
      const lyrics = textPart.trim() === ''
        ? (Array(numLanguages).fill('') as string[])
        : textPart.trim().split('|').map((s) => s.trim());
      raw.push({ chord: match[1].trim(), lyrics });
    }

    raw.forEach((seg, segmentIndex) => {
      const chinese = stripWhitespace(seg.lyrics[chineseLanguageIndex] ?? '');
      if (chinese === '') return; // chord-only / empty segment: nothing to align against
      out.push({
        ...seg,
        lineNumber,
        segmentIndex,
        chinese,
        start: cursor,
        end: cursor + [...chinese].length,
      });
      cursor += [...chinese].length;
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateAlignment(ecbChars: string[], rowChars: string[]): void {
  const limit = Math.min(ecbChars.length, rowChars.length);
  for (let i = 0; i < limit; i++) {
    if (ecbChars[i] !== rowChars[i]) {
      fail(
        `Mismatch at char ${i}: ECB has "${context(ecbChars, i)}" but rows have "${context(rowChars, i)}"`,
      );
    }
  }
  if (ecbChars.length !== rowChars.length) {
    const longer = ecbChars.length > rowChars.length ? 'ECB' : 'rows';
    fail(
      `Length mismatch: ECB Chinese has ${ecbChars.length} chars, rows have ${rowChars.length} chars ` +
        `(they agree for the first ${limit}; ${longer} has the extra text: ` +
        `"${(ecbChars.length > rowChars.length ? ecbChars : rowChars).slice(limit, limit + 12).join('')}")`,
    );
  }
}

function context(chars: string[], i: number): string {
  const before = chars.slice(Math.max(0, i - 4), i).join('');
  const after = chars.slice(i, i + 5).join('');
  return `...${before}${after}...`;
}

// ---------------------------------------------------------------------------
// Syllable tooling
// ---------------------------------------------------------------------------

function getSyllables(text: string, lyricToolsDir: string): WeightedSyllable[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      'uv',
      ['run', '--directory', lyricToolsDir, 'syllable_tools/C_cli.py', text],
      { encoding: 'utf8' },
    );
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return fail(`syllable CLI failed for ${JSON.stringify(text)}: ${err.stderr || err.message}`);
  }
  let parsed: SyllableToolOutput;
  try {
    parsed = JSON.parse(stdout) as SyllableToolOutput;
  } catch {
    return fail(`syllable CLI returned non-JSON output for ${JSON.stringify(text)}: ${stdout.slice(0, 200)}`);
  }
  return weighSyllables(parsed);
}

/**
 * Attach a syllable weight to each flat entry, using `word_breakdown[i].count` as the
 * authoritative syllable count for a word. When a word yields fewer entries than its
 * count, the surplus is pushed onto its trailing entries (so a one-entry "rather" weighs
 * 2 and a chunk boundary can never land inside it).
 */
function weighSyllables(parsed: SyllableToolOutput): WeightedSyllable[] {
  const flat = parsed.syllables ?? [];
  const breakdown = parsed.word_breakdown ?? [];

  const entriesPerWord = new Map<number, number>();
  for (const s of flat) entriesPerWord.set(s.word_index, (entriesPerWord.get(s.word_index) ?? 0) + 1);

  const seenPerWord = new Map<number, number>();
  return flat.map((s) => {
    const n = entriesPerWord.get(s.word_index) ?? 1;
    const count = breakdown[s.word_index]?.count ?? n;
    const seen = seenPerWord.get(s.word_index) ?? 0;
    seenPerWord.set(s.word_index, seen + 1);

    if (count <= n) return { ...s, weight: 1 };
    const base = Math.floor(count / n);
    const remainder = count - base * n;
    // The last `remainder` entries of the word each carry one extra syllable.
    const weight = base + (seen >= n - remainder ? 1 : 0);
    return { ...s, weight };
  });
}

/**
 * Character offsets in `word` at which each syllable starts, plus a final offset of
 * word.length — so syllable i spans word.slice(cuts[i], cuts[i + 1]).
 *
 * Walks the original word and the (lower-cased, punctuation-free) syllable strings in
 * lockstep so that casing and punctuation from the source text survive ("I'd", "side,").
 * Returns null when the two cannot be reconciled, so the caller can fall back to the
 * raw syllable strings.
 */
function syllableCuts(word: string, syllables: string[]): number[] | null {
  const cuts: number[] = [0];
  let w = 0;
  for (const syllable of syllables) {
    let consumed = 0;
    while (w < word.length && consumed < syllable.length) {
      if (word[w].toLowerCase() === syllable[consumed].toLowerCase()) consumed++;
      w++; // characters that don't match (punctuation) stay with the current syllable
    }
    if (consumed < syllable.length) return null;
    cuts.push(w);
  }
  cuts[cuts.length - 1] = word.length; // trailing punctuation joins the last syllable
  return cuts;
}

/**
 * Render a consecutive run of syllables as text.
 *
 * Words consumed whole keep their original spelling; a word cut mid-way contributes a
 * hyphen-suffixed head ("wait-") here and a bare tail ("ing") to the next sub-chunk.
 * Words are joined with a single space.
 */
function renderChunk(taken: Syllable[], wordSyllables: Map<number, string[]>): string {
  const pieces: string[] = [];
  let i = 0;
  while (i < taken.length) {
    const wordIndex = taken[i].word_index;
    let j = i;
    while (j + 1 < taken.length && taken[j + 1].word_index === wordIndex) j++;

    const word = taken[i].word;
    const all = wordSyllables.get(wordIndex) ?? [];
    const first = taken[i].syllable_index;
    const last = taken[j].syllable_index;
    const isWordEnd = last === all.length - 1;

    if (first === 0 && isWordEnd) {
      pieces.push(word);
    } else {
      const cuts = syllableCuts(word, all);
      const piece = cuts
        ? word.slice(cuts[first], cuts[last + 1])
        : taken.slice(i, j + 1).map((s) => s.syllable).join('');
      // No leading hyphen on a continuation; trailing hyphen only when cut mid-word.
      pieces.push(isWordEnd ? piece : `${piece}-`);
    }
    i = j + 1;
  }
  return pieces.join(' ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) fail('usage: node dist/ecb-syllable-matcher.js <input.json>');

  let input: Input;
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')) as Input;
  } catch (e) {
    return fail(`could not read/parse input JSON ${inputPath}: ${(e as Error).message}`);
  }

  if (!input.ecbFilePath) fail('input is missing "ecbFilePath"');
  if (typeof input.startLine !== 'number' || typeof input.endLine !== 'number') {
    fail('input needs numeric "startLine" and "endLine" (1-indexed, inclusive)');
  }
  if (input.startLine > input.endLine) fail('"startLine" must be <= "endLine"');
  if (!Array.isArray(input.rows) || input.rows.length === 0) fail('input needs a non-empty "rows" array');

  const chineseLanguageIndex = input.chineseLanguageIndex ?? 0;
  const lyricToolsDir = expandHome(input.lyricToolsDir ?? DEFAULT_LYRIC_TOOLS_DIR);
  const ecbPath = path.resolve(input.ecbFilePath);

  let rawFile: string;
  try {
    rawFile = fs.readFileSync(ecbPath, 'utf8');
  } catch (e) {
    return fail(`could not read ECB file ${ecbPath}: ${(e as Error).message}`);
  }
  const lines = rawFile.split('\n');

  let numLanguages = 1;
  for (const line of lines) {
    const m = line.match(/^%%languages\s+(.+)/);
    if (m) {
      numLanguages = m[1].split(',').length;
      break;
    }
  }

  // 1. Segments in range, with their char ranges in the stripped-Chinese coordinate space.
  const segments = extractSegments(lines, input.startLine, input.endLine, numLanguages, chineseLanguageIndex);
  if (segments.length === 0) {
    fail(`no lyric segments with Chinese text found in ${input.ecbFilePath} lines ${input.startLine}-${input.endLine}`);
  }

  // 2. Validate the two concatenations match character for character.
  const ecbChars = [...segments.map((s) => s.chinese).join('')];
  const rowStripped = input.rows.map((r) => stripWhitespace(r.originalChinese ?? ''));
  const rowChars = [...rowStripped.join('')];
  validateAlignment(ecbChars, rowChars);

  const warnings: string[] = [];
  const contributions = new Map<LocatedSegment, string[]>();
  for (const seg of segments) contributions.set(seg, []);

  // 3-5. Map each row's char span onto segments, then fill sub-chunks with syllables.
  let rowStart = 0;
  input.rows.forEach((row, rowIndex) => {
    const rowLen = [...rowStripped[rowIndex]].length;
    const rowEnd = rowStart + rowLen;

    const subChunks: SubChunk[] = [];
    for (const seg of segments) {
      const overlap = Math.min(seg.end, rowEnd) - Math.max(seg.start, rowStart);
      if (overlap > 0) subChunks.push({ segment: seg, targetCharCount: overlap, text: '' });
    }

    if (subChunks.length > 0) {
      const syllables = getSyllables(row.translatedText ?? '', lyricToolsDir);
      const wordSyllables = new Map<number, string[]>();
      for (const s of syllables) {
        const list = wordSyllables.get(s.word_index) ?? [];
        list[s.syllable_index] = s.syllable;
        wordSyllables.set(s.word_index, list);
      }

      let pos = 0;
      subChunks.forEach((chunk, k) => {
        const isLast = k === subChunks.length - 1;
        let taken: WeightedSyllable[];
        let takenWeight = 0;
        if (isLast) {
          // The row's last sub-chunk absorbs whatever syllables remain (over or under).
          taken = syllables.slice(pos);
          pos = syllables.length;
        } else {
          const from = pos;
          // Fill up to the target without overshooting; an entry that weighs more than
          // the remaining budget stays for the next sub-chunk rather than being split.
          while (pos < syllables.length && takenWeight + syllables[pos].weight <= chunk.targetCharCount) {
            takenWeight += syllables[pos].weight;
            pos++;
          }
          taken = syllables.slice(from, pos);
        }
        for (const s of taken) if (isLast) takenWeight += s.weight;
        chunk.text = renderChunk(taken, wordSyllables);

        const where = `line ${chunk.segment.lineNumber} segment ${chunk.segment.segmentIndex} ("${chunk.segment.chinese}")`;
        if (!isLast && pos >= syllables.length && takenWeight < chunk.targetCharCount) {
          warnings.push(
            `Row ${rowIndex} ("${row.originalChinese}") ran out of syllables: ${where} needed ` +
              `${chunk.targetCharCount} syllable(s) but only ${takenWeight} were left.`,
          );
        }
        if (isLast && taken.length === 0) {
          warnings.push(
            `Row ${rowIndex} ("${row.originalChinese}") had no syllables left for its final sub-chunk: ` +
              `${where} (nominal target ${chunk.targetCharCount}) got empty text.`,
          );
        }
      });

      if (input.debug) {
        console.error(`row ${rowIndex}: ${row.originalChinese} | ${row.translatedText}`);
        for (const chunk of subChunks) {
          console.error(
            `  -> line ${chunk.segment.lineNumber} seg ${chunk.segment.segmentIndex} ` +
              `(target ${chunk.targetCharCount}, chinese "${chunk.segment.chinese}"): ${JSON.stringify(chunk.text)}`,
          );
        }
      }

      for (const chunk of subChunks) contributions.get(chunk.segment)!.push(chunk.text);
    }

    rowStart = rowEnd;
  });

  // 6-7. Reassemble per segment and emit.
  const output: Output = {
    segments: segments.map((seg) => ({
      lineNumber: seg.lineNumber,
      segmentIndex: seg.segmentIndex,
      chinese: seg.chinese,
      newText: (contributions.get(seg) ?? []).filter((t) => t !== '').join(' '),
    })),
    warnings,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
