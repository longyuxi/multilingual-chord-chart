// ECB lyrics -> NormalizedLyrics (tab-pinyinizer-ilg.2): the known-lyrics side
// of the alignment, reduced to the unit that survives a noisy ASR transcript.

import { createHash } from 'crypto';

import { containsCjk, syllableTokens } from './pinyin';
import { isStandaloneMarkerLine, stripInlineMarkers } from './ecb-markers';
import type { LyricLine, LyricSyllable, NormalizedLyrics } from './types';

/**
 * Everything a latin line may still sing. `'` survives because it is
 * word-internal: dropping it would turn `they'll` into one token instead of the
 * `they` + `ll` that syllableTokens (and the provider side) produce.
 */
const NON_WORD_RE = /[^\p{L}\p{N}']+/gu;

const CONFIG_RE = /^%%(\S+)\s*(.*)$/;
const SECTION_RE = /^<(.+)>$/;
const LINE_SEGMENT_RE = /\[([^\]]*)\]([^\[]*)/g;

/**
 * Parses an .ecb file into per-line syllables ready for alignment.
 *
 * The file's own pinyin track is deliberately not used, even when present: the
 * ASR side has no pinyin track (providers emit characters or words, which ilg.3
 * normalizes with syllableTokens), so both sides must derive syllables from the
 * primary-language characters through the same function. Reusing the file's
 * pinyin would compare two different tokenizations and drop matches.
 */
export function normalizeLyrics(rawEcb: string): NormalizedLyrics {
  const sourceLines = rawEcb.split('\n');
  const { languages, youtube } = readMeta(sourceLines);

  // The first %%languages entry containing CJK is the track the audio actually
  // sings -- a `pinyin` or `jyutping` entry carries none, so it is never a
  // candidate. A file whose entries are all romanized falls back to the first.
  const primaryIndex = Math.max(0, languages.findIndex((entry) => containsCjk(entry)));
  const language = languages[primaryIndex];

  const lines: LyricLine[] = [];
  let section = '';

  sourceLines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    if (CONFIG_RE.test(line)) return; // %% metadata, already read above
    if (line.startsWith('%')) return; // % comment
    if (isStandaloneMarkerLine(trimmed)) return; // @M:SS: timing only, never text
    if (trimmed.startsWith('>')) return; // free text
    const sectionMatch = trimmed.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      return;
    }
    if (!line.includes('[')) return; // stray prose: nothing is sung here

    const segmentTexts = primarySegmentTexts(line, primaryIndex);
    if (segmentTexts.length === 0) return; // chord-only line

    // Tokenization follows the line's own content, not its track's name: the
    // name `chinese` is ASCII, and a mostly-Chinese song can still carry a line
    // that is entirely latin.
    const rawText = segmentTexts.join(' ');
    const lineIsCjk = containsCjk(rawText);
    const text = cleanLyricText(rawText, lineIsCjk);
    const syllables = syllablesOf(text, lineIsCjk);
    if (syllables.length === 0) return; // nothing the DP could match

    lines.push({ lineIndex, text, syllables, section });
  });

  // Only the matching language is hashed, so adding or editing a pinyin or
  // translation track never invalidates a paid ASR result (docs/timestamps-
  // contract.md). `text` is exactly what the aligner sends, so a hash hit means
  // the provider would have been asked for the same thing.
  const lyricHash = createHash('sha256')
    .update(lines.map((line) => line.text).join('\n'))
    .digest('hex');

  return { videoId: youtube, language, lines, lyricHash };
}

/** `%%languages` and `%%youtube` from the metadata header. */
function readMeta(lines: string[]): { languages: string[]; youtube: string | null } {
  let languages: string[] | null = null;
  let youtube: string | null = null;

  for (const line of lines) {
    const match = line.match(CONFIG_RE);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'languages' && languages === null) {
      languages = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    } else if (key === 'youtube' && youtube === null) {
      youtube = value.trim() || null;
    }
  }

  if (languages === null || languages.length === 0) {
    throw new Error('ECB file has no %%languages header, so no track can be matched');
  }
  return { languages, youtube };
}

/**
 * The primary-language text of every non-empty segment of one lyric line, in
 * reading order, with chords and inline `@M:SS` markers stripped.
 */
function primarySegmentTexts(line: string, primaryIndex: number): string[] {
  const texts: string[] = [];
  const collect = (segmentText: string) => {
    const parts = stripInlineMarkers(segmentText).split('|');
    const text = (parts[primaryIndex] ?? '').trim();
    if (text !== '') texts.push(text);
  };

  // A line may open with a chordless segment, e.g. `请|qing|please[C]用...`.
  collect(line.slice(0, line.indexOf('[')));
  // match[1] is the chord, which is never sung; match[2] may hold an inline
  // marker for the *next* segment, which `collect` strips out.
  for (const match of line.matchAll(LINE_SEGMENT_RE)) collect(match[2]);
  return texts;
}

/**
 * Collapses a line's segments into one run of singable text. Latin runs inside a
 * CJK line are filler -- `K歌之王` is sung as `歌之王` -- because Mandarin ASR
 * never emits them and they would only add unmatched tokens. What counts as CJK
 * is containsCjk's answer, not a second copy of the ranges, so `text` and
 * `syllables` can never disagree about which characters are singable.
 */
function cleanLyricText(raw: string, lineIsCjk: boolean): string {
  const kept = lineIsCjk
    ? Array.from(raw, (char) => (containsCjk(char) ? char : ' ')).join('')
    : raw.replace(NON_WORD_RE, ' ');
  return kept.replace(/\s+/g, ' ').trim();
}

/** One syllable per CJK character; one per syllableTokens token of each word. */
function syllablesOf(text: string, lineIsCjk: boolean): LyricSyllable[] {
  const syllables: LyricSyllable[] = [];

  if (lineIsCjk) {
    // One character is one sung syllable in Chinese, so characters and tokens
    // line up 1:1 and each syllable can name the character it came from.
    for (const char of text) {
      for (const pinyin of syllableTokens(char)) syllables.push({ pinyin, source: char });
    }
    return syllables;
  }

  for (const word of text.split(' ')) {
    if (word === '') continue;
    for (const pinyin of syllableTokens(word)) syllables.push({ pinyin, source: word });
  }
  return syllables;
}
