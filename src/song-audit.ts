// Audits every `songs/*.ecb` against the song standard (tab-pinyinizer-i8v.1).
//
// The standard asks four questions of each file -- are the right tracks there, is the
// translation syllable-matched, is every line timestamped, is the text clean -- and
// this script is the only place those questions are answered mechanically. It never
// writes to a song: the output is the input to remediation tasks, not a fixup tool.
//
// Two deliberate deviations from "measure everything at once":
//
//   * English syllables come from lyric-translator-tools' `C_cli.py --count`, the same
//     CMU-dictionary count `ecb-syllable-matcher` uses to place text, so the auditor and
//     the placer agree about what "matched" means. It is called exactly ONCE for the
//     whole run (batch mode) -- one `uv run` spawn per string would put a full-catalog
//     audit in the ten-minute range, which is useless as a gate.
//   * Syllables of the *sung* track are counted from the file's own romanization column
//     (one whitespace token per sung syllable), not from the Han characters. That keeps
//     the count honest for erhua and neutral tones and, unlike a Han count, it still
//     means something when the text is wrong.
//
// `src/web/` is excluded from the CLI build (tab-pinyinizer-xql), so the ECB grammar is
// re-implemented here the same way `src/timestamps/check.ts` does it; marker pairing is
// imported from `ecb-markers.ts` so the auditor and the pipeline share one grammar. That
// re-implementation includes the chordless segment a line may open with (`请|qing|please[C]
// 用...`): text before the first bracket is part of the sung line, so dropping it would
// make the auditor disagree with the placer (tab-pinyinizer-i8v.7).
//
// Usage:
//   npm run build:cli
//   node dist/song-audit.js [--json] [--check] [--verbose] [--format table|md]
//     [--line-tolerance 1] [--segment-tolerance 2]
//     [--lyric-tools-dir <path>] [songs/a.ecb ...]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isStandaloneMarkerLine } from './timestamps/ecb-markers';
import { REPO_ROOT } from './timestamps/paths';

/**
 * Line totals must land within one syllable. A line is what the singer phrases, so a
 * line that is one syllable long or short is a judgement call about how the phrase is
 * held; two or more is a translation that does not fit the music.
 */
export const DEFAULT_LINE_TOLERANCE = 1;

/**
 * Segments get twice the slack. Segments are chord boundaries *inside* a line, and a
 * translation is placed at those seams by syllable count, so a correct line can still
 * split unevenly: `condensed_blue_whale`'s hand-made `蓝鲸的宿` / `命` carries 4+1 sung
 * syllables against `blue whale's` / `destiny` at 2+3 -- line-perfect (5 vs 5),
 * segment-imperfect, and right. Grading segments as tightly as lines would fail the
 * golden reference for being correctly aligned.
 */
export const DEFAULT_SEGMENT_TOLERANCE = 2;

const DEFAULT_LYRIC_TOOLS_DIR = path.join(os.homedir(), 'workdir', 'lyric-translator-tools');

const REQUIRED_METADATA = ['title', 'artist', 'languages', 'youtube', 'transpose'] as const;

/** Tracks that romanize the sung text instead of translating it. */
const ROMANIZATION_TRACKS = new Set(['pinyin', 'jyutping']);

/**
 * The translation track is named `english`. `translation` is accepted only so the
 * auditor can name the file that still uses it (`when_you_are_old`) in a `wrong-track-
 * name` finding instead of reporting it as having no translation at all.
 */
const TRANSLATION_TRACKS = new Set(['english', 'translation']);

const CONFIG_RE = /^%%(\S+)\s*(.*)$/;
const SECTION_RE = /^<(.+)>$/;
const SEGMENT_RE = /\[([^\]]*)\]([^\[]*)/g;
/** `@45`, `@1:30`, `@1:02:03`, inline or alone on a line. */
const MARKER_RE = /@\d+(?::\d+){0,2}/g;

/**
 * Kangxi radicals (U+2E80-U+2FDF) and CJK compatibility ideographs (U+F900-U+FAFF) used
 * where an ordinary Han character belongs. Unlike full-width punctuation these are never
 * a style choice: they break text search, copy/paste, and every Han-character count,
 * including lyric-translator-tools' (`annotate_zh_line` only counts U+4E00-9FFF and
 * U+3400-4DBF, so `⼭` is silently zero syllables).
 */
const COMPATIBILITY_IDEOGRAPH_RE = /[\u2e80-\u2fdf\uf900-\ufaff]/;

/** Full-width punctuation (U+3000-U+303F, U+FF00-U+FF65): cosmetic, not a defect. */
const FULLWIDTH_PUNCTUATION_RE = /[\u3000-\u303f\uff01-\uff65]/;

/**
 * Han after NFKC, so a Kangxi radical (U+2F00-U+2FDF) counts as the character it stands in
 * for. The radicals supplement (U+2E80-U+2EFF) is mostly fold-free, so it is listed
 * explicitly: `unnormalized-chars` still reports those codepoints as errors, but the
 * Han-count fallback must not silently undercount them in the meantime.
 *
 * The Ext B range has to be braced: `\u20000-\u2a6df` is read as `\u2000` plus the range
 * `0-\u2a6d`, which claims ASCII letters and digits as Han and misses U+20000-U+2A6DF
 * entirely (tab-pinyinizer-i8v.7). `assertHanRanges` pins both halves of that.
 */
const HAN_RE = /[\u2e80-\u2fdf\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2a6df}]/u;

export type FindingCode =
  | 'missing-metadata'
  | 'missing-languages'
  | 'unknown-song-type'
  | 'wrong-track-layout'
  | 'missing-translation-track'
  | 'wrong-track-name'
  | 'bad-field-count'
  | 'empty-track'
  | 'line-syllable-mismatch'
  | 'segment-syllable-mismatch'
  | 'no-timestamps'
  | 'partial-timestamps'
  | 'unnormalized-chars'
  | 'fullwidth-punctuation'
  | 'romanization-mismatch';

export type Severity = 'error' | 'warning';

/** A warning does not fail `--check`: it marks text worth a human look, not a defect. */
const SEVERITY: Record<FindingCode, Severity> = {
  'missing-metadata': 'error',
  'missing-languages': 'error',
  'unknown-song-type': 'error',
  'wrong-track-layout': 'error',
  'missing-translation-track': 'error',
  'wrong-track-name': 'error',
  'bad-field-count': 'error',
  'empty-track': 'error',
  'line-syllable-mismatch': 'error',
  'segment-syllable-mismatch': 'error',
  'no-timestamps': 'error',
  'partial-timestamps': 'error',
  'unnormalized-chars': 'error',
  'fullwidth-punctuation': 'warning',
  'romanization-mismatch': 'warning',
};

/** One construction path, so a finding can never carry a severity its code contradicts. */
function finding(code: FindingCode, message: string, lines?: number[]): Finding {
  return { code, severity: SEVERITY[code], message, ...(lines ? { lines } : {}) };
}

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
  /** 1-indexed source lines the finding is about, when it is line-scoped. */
  lines?: number[];
}

export interface LineMeasurement {
  /** 1-indexed source line. */
  lineIndex: number;
  sung: number;
  translated: number;
  segments: SegmentMeasurement[];
}

export interface SegmentMeasurement {
  /** 0-indexed position within the line, chord-only segments included. */
  segmentIndex: number;
  chord: string;
  sungText: string;
  translatedText: string;
  sung: number;
  translated: number;
}

export type SongType = 'mandarin' | 'cantonese' | 'english' | 'unknown';

export interface SongAudit {
  file: string;
  title: string;
  artist: string;
  songType: SongType;
  languages: string[];
  youtube: string | null;
  lyricLines: number;
  markedLines: number;
  measuredLines: number;
  lineMismatches: number;
  segmentMismatches: number;
  findings: Finding[];
  lines: LineMeasurement[];
}

export interface AuditOptions {
  lineTolerance: number;
  segmentTolerance: number;
  lyricToolsDir: string;
}

export interface AuditReport {
  options: AuditOptions;
  songs: SongAudit[];
  summary: {
    songs: number;
    passing: number;
    failing: number;
    findings: Partial<Record<FindingCode, number>>;
  };
}

interface ParsedLine {
  lineIndex: number;
  segments: ParsedSegment[];
  /** A standalone `@M:SS` line directly above this lyric line. */
  carriedMarker: boolean;
  inlineMarkers: number;
}

interface ParsedSegment {
  segmentIndex: number;
  chord: string;
  /** Empty for a chord-only segment. */
  tracks: string[];
}

interface ParsedSong {
  meta: Record<string, string>;
  lines: ParsedLine[];
}

function parseSong(raw: string): ParsedSong {
  const meta: Record<string, string> = {};
  const lines: ParsedLine[] = [];
  const sourceLines = raw.split('\n');
  let previousWasMarker = false;

  sourceLines.forEach((line, index) => {
    const trimmed = line.trim();
    const config = line.match(CONFIG_RE);
    if (config) {
      meta[config[1].toLowerCase()] = config[2].trim();
      previousWasMarker = false;
      return;
    }
    if (isStandaloneMarkerLine(trimmed)) {
      previousWasMarker = true;
      return;
    }
    if (trimmed.startsWith('%') || trimmed.startsWith('>') || SECTION_RE.test(trimmed)) {
      previousWasMarker = false;
      return;
    }
    if (!line.includes('[')) {
      previousWasMarker = false;
      return;
    }

    const inlineMarkers = (line.match(MARKER_RE) ?? []).length;
    const withoutMarkers = line.replace(MARKER_RE, '');
    const segments: ParsedSegment[] = [];
    // Text before the first bracket is a chordless segment at segmentIndex 0 -- the
    // numbering `ecb-syllable-matcher` emits -- so per-line counts cover the whole line.
    // Markers in the leading run were already counted above and are stripped here, and a
    // run of nothing but markers leaves no segment.
    const leadingText = withoutMarkers.slice(0, withoutMarkers.indexOf('[')).trim();
    if (leadingText !== '') {
      segments.push({
        segmentIndex: 0,
        chord: '',
        tracks: leadingText.split('|').map((track) => track.trim()),
      });
    }
    for (const match of withoutMarkers.matchAll(SEGMENT_RE)) {
      const chord = match[1].trim();
      const text = match[2].trim();
      segments.push({
        segmentIndex: segments.length,
        chord,
        // A chord-only segment (`[Am][Dm]`) has no lyric text and therefore no tracks.
        tracks: text === '' ? [] : text.split('|').map((track) => track.trim()),
      });
    }
    if (segments.length === 0 || segments.every((segment) => segment.tracks.length === 0)) {
      previousWasMarker = false;
      return; // instrumental / chord-only line: nothing is sung
    }

    lines.push({
      lineIndex: index + 1,
      segments,
      carriedMarker: previousWasMarker,
      inlineMarkers,
    });
    previousWasMarker = false;
  });

  return { meta, lines };
}

/** `%%languages` as a list. Empty entries (a stray `,,`) are dropped so the declared
 * track count is what both the audit and the syllable batch agree on. */
function readLanguages(meta: Record<string, string>): string[] {
  return (meta.languages ?? '')
    .split(',')
    .map((language) => language.trim())
    .filter((language) => language !== '');
}

function nfkc(text: string): string {
  return text.normalize('NFKC');
}

function hanCount(text: string): number {
  let count = 0;
  for (const char of nfkc(text)) {
    if (HAN_RE.test(char)) count += 1;
  }
  return count;
}

/**
 * `HAN_RE` fails silently when it is wrong: the misparse that motivated this guard claimed
 * every ASCII letter as Han, so instead of a number being off the audit "measured" English
 * lines as Han syllables and had nothing to compare. There is no test runner in this repo,
 * so the range behaviour that matters is pinned at the entry point: Ext B is Han, ASCII
 * letters and digits are not, and the radicals supplement is.
 */
function assertHanRanges(): void {
  const cases: [string, boolean][] = [
    ['\u{20000}', true],
    ['\u{2a6df}', true],
    ['\u2e80', true],
    ['\u2f2d', true],
    ['A', false],
    ['z', false],
    ['0', false],
    ['9', false],
  ];
  for (const [text, expected] of cases) {
    const actual = hanCount(text) === 1;
    if (actual !== expected) {
      throw new Error(
        `HAN_RE counts ${JSON.stringify(text)} as Han: ${actual}, expected ${expected}`,
      );
    }
  }
}

function tokens(text: string): number {
  return text.split(/\s+/).filter((token) => token !== '').length;
}

/**
 * Syllables the singer sings in one segment: the romanization column's token count when
 * the file has one, otherwise the Han-character count (a file with no romanization track
 * fails the layout check anyway, but its syllable numbers are still worth reporting).
 */
function sungSyllables(tracks: string[], romanizationIndex: number): number {
  const romanization = romanizationIndex >= 0 ? (tracks[romanizationIndex] ?? '') : '';
  if (romanization !== '') return tokens(romanization);
  return hanCount(tracks[0] ?? '');
}

/**
 * One batch call for the whole run. Returns counts positionally, so an input containing a
 * newline would silently shift every later result -- hence the assertion rather than a
 * best effort.
 */
function countEnglishSyllables(texts: string[], lyricToolsDir: string): number[] {
  if (texts.length === 0) return [];
  texts.forEach((text, index) => {
    if (text.includes('\n')) throw new Error(`syllable input ${index} contains a newline`);
  });
  const stdout = execFileSync(
    'uv',
    [
      'run',
      '--directory',
      lyricToolsDir,
      'syllable_tools/C_cli.py',
      '--count',
      '-',
    ],
    { input: texts.join('\n'), maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
  );
  const counts = stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseInt(line, 10));
  if (counts.length !== texts.length) {
    throw new Error(`expected ${texts.length} syllable counts, got ${counts.length}`);
  }
  return counts;
}

function detectSongType(languages: string[], raw: string): SongType {
  const normalized = languages.map((language) => language.toLowerCase());
  if (normalized.length === 1 && normalized[0] === 'english') return 'english';
  if (normalized.includes('jyutping')) return 'cantonese';
  if (normalized.includes('pinyin')) return 'mandarin';
  // No romanization track: fall back to whether the file sings Han characters at all.
  return hanCount(raw) > 0 ? 'mandarin' : 'unknown';
}

function expectedLayout(type: SongType): string[] {
  switch (type) {
    case 'mandarin':
      return ['chinese', 'pinyin', 'english'];
    case 'cantonese':
      return ['chinese', 'jyutping', 'english'];
    case 'english':
      return ['english'];
    default:
      return [];
  }
}

function checkMetadata(meta: Record<string, string>): Finding[] {
  const missing = REQUIRED_METADATA.filter((key) => !meta[key]);
  if (missing.length === 0) return [];
  return [
    finding('missing-metadata', `missing ${missing.map((key) => `%%${key}`).join(', ')}`),
  ];
}

function checkLayout(languages: string[], type: SongType): Finding[] {
  const expected = expectedLayout(type);
  const findings: Finding[] = [];
  const normalized = languages.map((language) => language.toLowerCase());

  const wrongName = normalized.findIndex(
    (language, index) => expected[index] !== undefined && expected[index] !== language
      && !(expected[index] === 'english' && TRANSLATION_TRACKS.has(language)),
  );
  if (wrongName >= 0) {
    findings.push(finding(
      'wrong-track-layout',
      `track ${wrongName + 1} is "${languages[wrongName]}", expected "${expected[wrongName]}"`,
  ));
  } else if (normalized.length < expected.length) {
    // A prefix of the expected layout: the file is missing tracks, not using wrong ones.
    findings.push(finding(
      'missing-translation-track',
      `has ${languages.join(', ')}; the standard wants ${expected.join(', ')}`,
  ));
  } else if (normalized.length > expected.length) {
    findings.push(finding(
      'wrong-track-layout',
      `has ${normalized.length} tracks (${languages.join(', ')}), expected ${expected.join(', ')}`,
  ));
  }

  const translationTrack = normalized.findIndex((language) => language === 'translation');
  if (translationTrack >= 0) {
    findings.push(finding(
      'wrong-track-name',
      `translation track is named "translation"; the standard uses "english"`,
  ));
  }

  return findings;
}

function auditSong(
  file: string,
  raw: string,
  options: AuditOptions,
  englishCounts: number[],
  countOffset: { value: number },
): SongAudit {
  const parsed = parseSong(raw);
  const languages = readLanguages(parsed.meta);
  const normalized = languages.map((language) => language.toLowerCase());
  const type = detectSongType(languages, raw);

  const findings: Finding[] = [];
  if (languages.length === 0) {
    findings.push(finding(
      'missing-languages',
      'no %%languages; every lyric segment is unlabelled',
  ));
  }
  if (type === 'unknown') {
    findings.push(finding(
      'unknown-song-type',
      'cannot tell whether this is Mandarin, Cantonese or English-only',
  ));
  }
  findings.push(...checkMetadata(parsed.meta));
  if (languages.length > 0) findings.push(...checkLayout(languages, type));

  const romanizationIndex = normalized.findIndex((language) => ROMANIZATION_TRACKS.has(language));
  const translationIndex = normalized.findIndex((language) => TRANSLATION_TRACKS.has(language));

  const badFields: number[] = [];
  const emptyTracks: number[] = [];
  const romanizationMismatch: number[] = [];

  parsed.lines.forEach((line) => {
    line.segments.forEach((segment) => {
      if (segment.tracks.length === 0) return; // chord-only
      if (segment.tracks.length !== languages.length) badFields.push(line.lineIndex);
      const filled = segment.tracks.filter((track) => track !== '');
      if (filled.length > 0 && filled.length < languages.length) emptyTracks.push(line.lineIndex);
      if (romanizationIndex >= 0) {
        const romanization = segment.tracks[romanizationIndex] ?? '';
        const han = hanCount(segment.tracks[0] ?? '');
        if (romanization !== '' && han > 0 && tokens(romanization) !== han) {
          romanizationMismatch.push(line.lineIndex);
        }
      }
    });
  });

  const unique = (values: number[]) => Array.from(new Set(values));
  if (badFields.length > 0) {
    findings.push(finding(
        'bad-field-count',
        `${badFields.length} segment(s) do not have ${languages.length} | separated tracks`,
        unique(badFields),
    ));
  }
  if (emptyTracks.length > 0) {
    findings.push(finding(
        'empty-track',
        `${emptyTracks.length} segment(s) leave a declared track empty`,
        unique(emptyTracks),
    ));
  }
  if (romanizationMismatch.length > 0) {
    findings.push(finding(
        'romanization-mismatch',
        `${romanizationMismatch.length} segment(s) where romanization tokens != Han characters`,
        unique(romanizationMismatch),
    ));
  }

  // --- syllable match ------------------------------------------------------
  const measurements: LineMeasurement[] = [];
  const lineMismatchLines: number[] = [];
  const segmentMismatchLines: number[] = [];
  let measuredLines = 0;

  parsed.lines.forEach((line) => {
    const segments: SegmentMeasurement[] = line.segments.map((segment) => {
      const sung = segment.tracks.length === 0 ? 0 : sungSyllables(segment.tracks, romanizationIndex);
      const translatedText =
        translationIndex >= 0 ? (segment.tracks[translationIndex] ?? '') : '';
      // The whole catalog is counted in one batch, so the consumption order here must
      // match the request order in collectEnglishTexts exactly: one count per
      // lyric-bearing segment of a file that HAS a translation column, including
      // segments whose English is empty. Skipping either cases shifts every later count.
      const consumesCount = translationIndex >= 0 && segment.tracks.length > 0;
      const translated = consumesCount ? (englishCounts[countOffset.value++] ?? 0) : 0;
      return {
        segmentIndex: segment.segmentIndex,
        chord: segment.chord,
        sungText: segment.tracks[0] ?? '',
        translatedText,
        sung,
        translated,
      };
    });

    const sung = segments.reduce((sum, segment) => sum + segment.sung, 0);
    const translated = segments.reduce((sum, segment) => sum + segment.translated, 0);
    // Nothing to compare when the sung track IS the English track, or when there is
    // no translation column and no romanization to count from.
    if (sung === 0 || translationIndex < 0 || translationIndex === 0) {
      measurements.push({ lineIndex: line.lineIndex, sung, translated, segments });
      return;
    }
    measuredLines += 1;
    measurements.push({ lineIndex: line.lineIndex, sung, translated, segments });

    if (Math.abs(sung - translated) > options.lineTolerance) {
      lineMismatchLines.push(line.lineIndex);
    } else if (
      segments.some(
        (segment) =>
          segment.sung > 0 &&
          segment.translatedText !== '' &&
          Math.abs(segment.sung - segment.translated) > options.segmentTolerance,
      )
    ) {
      segmentMismatchLines.push(line.lineIndex);
    }
  });

  if (lineMismatchLines.length > 0) {
    findings.push(
      finding(
        'line-syllable-mismatch',
        `${lineMismatchLines.length}/${measuredLines} line(s) off by more than ${options.lineTolerance}`,
        lineMismatchLines,
      ),
    );
  }
  if (segmentMismatchLines.length > 0) {
    findings.push(
      finding(
        'segment-syllable-mismatch',
        `${segmentMismatchLines.length} line(s) whose segments are off by more than ${options.segmentTolerance}`,
        segmentMismatchLines,
      ),
    );
  }

  // --- timestamps ----------------------------------------------------------
  // A marker counts for the line it annotates, whether it sat on its own line above or
  // inline in the lyric text; both forms are stripped before track splitting, so
  // `inlineMarkers` is the whole story for the inline case.
  const marked = parsed.lines.filter((line) => line.carriedMarker || line.inlineMarkers > 0)
    .length;
  if (parsed.lines.length > 0 && marked === 0) {
    findings.push(
      finding('no-timestamps', `none of the ${parsed.lines.length} lyric lines carries a marker`),
    );
  } else if (marked < parsed.lines.length) {
    findings.push(
      finding(
        'partial-timestamps',
        `${marked}/${parsed.lines.length} lyric lines carry a marker`,
        parsed.lines
          .filter((line) => !line.carriedMarker && line.inlineMarkers === 0)
          .map((line) => line.lineIndex),
      ),
    );
  }

  // --- text hygiene --------------------------------------------------------
  const unnormalized: number[] = [];
  const fullwidth: number[] = [];
  raw.split('\n').forEach((line, index) => {
    for (const char of line) {
      if (COMPATIBILITY_IDEOGRAPH_RE.test(char)) {
        unnormalized.push(index + 1);
        break;
      }
    }
    if (FULLWIDTH_PUNCTUATION_RE.test(line)) fullwidth.push(index + 1);
  });
  if (unnormalized.length > 0) {
    findings.push(finding(
        'unnormalized-chars',
        `${unnormalized.length} line(s) spell Han characters with Kangxi-radical or compatibility codepoints`,
        unnormalized,
    ));
  }
  if (fullwidth.length > 0) {
    findings.push(finding(
        'fullwidth-punctuation',
        `${fullwidth.length} line(s) use full-width punctuation where the catalog uses ASCII`,
        fullwidth,
    ));
  }

  return {
    file,
    title: parsed.meta.title ?? '',
    artist: parsed.meta.artist ?? '',
    songType: type,
    languages,
    youtube: parsed.meta.youtube ?? null,
    lyricLines: parsed.lines.length,
    markedLines: marked,
    measuredLines,
    lineMismatches: lineMismatchLines.length,
    segmentMismatches: segmentMismatchLines.length,
    findings,
    lines: measurements,
  };
}

/** Every English segment string across the catalog, in a stable order. */
function collectEnglishTexts(
  entries: { file: string; raw: string }[],
): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const entry of entries) {
    const parsed = parseSong(entry.raw);
    const languages = readLanguages(parsed.meta).map((language) => language.toLowerCase());
    const translationIndex = languages.findIndex((language) => TRANSLATION_TRACKS.has(language));
    const texts: string[] = [];
    if (translationIndex >= 0) {
      for (const line of parsed.lines) {
        for (const segment of line.segments) {
          if (segment.tracks.length === 0) continue;
          texts.push(segment.tracks[translationIndex] ?? '');
        }
      }
    }
    byFile.set(entry.file, texts);
  }
  return byFile;
}

export function auditSongs(files: string[], options: AuditOptions): AuditReport {
  const entries = files.map((file) => ({
    file,
    raw: fs.readFileSync(path.resolve(REPO_ROOT, file), 'utf8'),
  }));

  const englishByFile = collectEnglishTexts(entries);
  const flat: string[] = [];
  for (const entry of entries) flat.push(...(englishByFile.get(entry.file) ?? []));
  const counts = countEnglishSyllables(flat, options.lyricToolsDir);

  const offset = { value: 0 };
  const songs = entries.map((entry) =>
    auditSong(entry.file, entry.raw, options, counts, offset),
  );

  const findings: Partial<Record<FindingCode, number>> = {};
  let passing = 0;
  for (const song of songs) {
    const hard = song.findings.filter((finding) => finding.severity === 'error');
    if (hard.length === 0) passing += 1;
    for (const finding of hard) {
      findings[finding.code] = (findings[finding.code] ?? 0) + 1;
    }
  }

  return {
    options,
    songs,
    summary: { songs: songs.length, passing, failing: songs.length - passing, findings },
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function renderTable(report: AuditReport, verbose: boolean): string {
  const rows = report.songs.map((song) => {
    const hard = song.findings.filter((finding) => finding.severity === 'error');
    return [
      song.file.replace(/^songs\//, ''),
      song.songType,
      song.languages.join(',') || '-',
      `${song.markedLines}/${song.lyricLines}`,
      song.measuredLines === 0
        ? '-'
        : `${song.measuredLines - song.lineMismatches}ok/${song.lineMismatches}off`,
      hard.length === 0 ? 'PASS' : hard.map((finding) => finding.code).join(' '),
    ];
  });
  const header = ['file', 'type', 'languages', 'markers', 'syllable fit', 'findings'];
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index].length)),
  );
  const format = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd();

  const out: string[] = [format(header), format(widths.map((width) => '-'.repeat(width)))];
  for (const row of rows) out.push(format(row));

  out.push('');
  out.push(
    `${plural(report.summary.passing, 'song')} pass, ${plural(
      report.summary.failing,
      'song',
    )} fail (line tolerance ±${report.options.lineTolerance}, segment tolerance ±${report.options.segmentTolerance})`,
  );
  const codes = Object.entries(report.summary.findings).sort(([a], [b]) => a.localeCompare(b));
  if (codes.length > 0) {
    out.push('');
    out.push('findings:');
    for (const [code, count] of codes) out.push(`  ${code.padEnd(26)} ${count}`);
  }

  if (verbose) {
    for (const song of report.songs) {
      for (const finding of song.findings) {
        const lines = finding.lines && finding.lines.length > 0
          ? ` (lines ${finding.lines.slice(0, 12).join(', ')}${finding.lines.length > 12 ? ', ...' : ''})`
          : '';
        out.push(`${song.file}: ${finding.severity} ${finding.code}: ${finding.message}${lines}`);
      }
    }
  }

  return `${out.join('\n')}\n`;
}

function renderMarkdown(report: AuditReport): string {
  const out: string[] = [
    '| file | type | languages | markers | syllable fit | findings |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const song of report.songs) {
    const hard = song.findings.filter((finding) => finding.severity === 'error');
    out.push(
      [
        `\`${song.file}\``,
        song.songType,
        song.languages.join(', ') || '-',
        `${song.markedLines}/${song.lyricLines}`,
        song.measuredLines === 0
          ? '-'
          : `${song.measuredLines - song.lineMismatches}/${song.measuredLines}`,
        hard.length === 0 ? 'pass' : hard.map((finding) => `\`${finding.code}\``).join(' '),
      ].join(' | ').replace(/^/, '| ').concat(' |'),
    );
  }
  out.push('');
  out.push(
    `${report.summary.passing}/${report.summary.songs} songs pass ` +
      `(line tolerance ±${report.options.lineTolerance}, segment tolerance ±${report.options.segmentTolerance}).`,
  );
  return `${out.join('\n')}\n`;
}

interface CliOptions extends AuditOptions {
  files: string[];
  json: boolean;
  check: boolean;
  verbose: boolean;
  format: 'table' | 'md';
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    json: false,
    check: false,
    verbose: false,
    format: 'table',
    lineTolerance: DEFAULT_LINE_TOLERANCE,
    segmentTolerance: DEFAULT_SEGMENT_TOLERANCE,
    lyricToolsDir: DEFAULT_LYRIC_TOOLS_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[index];
    };
    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--check':
        options.check = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--format':
        options.format = value() === 'md' ? 'md' : 'table';
        break;
      case '--line-tolerance':
        options.lineTolerance = parseInt(value(), 10);
        break;
      case '--segment-tolerance':
        options.segmentTolerance = parseInt(value(), 10);
        break;
      case '--lyric-tools-dir':
        options.lyricToolsDir = value();
        break;
      default:
        if (!arg.startsWith('-')) options.files.push(arg);
        else throw new Error(`unknown option ${arg}`);
    }
  }

  if (options.files.length === 0) {
    const dir = path.join(REPO_ROOT, 'songs');
    options.files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ecb'))
      .sort()
      .map((name) => path.join('songs', name));
  }

  return options;
}

function main(): void {
  assertHanRanges();
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`song-audit: ${(error as Error).message}`);
    process.exit(2);
  }

  const report = auditSongs(options.files, {
    lineTolerance: options.lineTolerance,
    segmentTolerance: options.segmentTolerance,
    lyricToolsDir: options.lyricToolsDir,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (options.format === 'md') {
    process.stdout.write(renderMarkdown(report));
  } else {
    process.stdout.write(renderTable(report, options.verbose));
  }

  if (options.check && report.summary.failing > 0) process.exit(1);
}

if (require.main === module) main();
