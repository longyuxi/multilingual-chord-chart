// Offline verifier for the `@M:SS` markers in .ecb files
// (tab-pinyinizer-ilg.7).
//
// This repo has no test runner or CI, so `npm run check-timestamps` is the only
// cheap correctness signal for timestamped lyrics: it never touches the network,
// never re-bills a provider, and gives the same answer twice. Hard errors
// (non-monotonic order, duplicate times, times past the end of the video) exit
// non-zero; everything else is a warning, because an imperfectly placed marker
// is still a usable file and only a human can say whether it is right.
//
// The lyric grammar is re-implemented here rather than imported from
// normalize.ts: the verifier must work on a file the normalizer would reject,
// and src/web/ is excluded from the CLI build (tab-pinyinizer-xql). Marker
// pairing (a standalone marker line annotating the next line's first segment, an
// inline marker annotating the segment after it, inline winning over a carried
// marker) mirrors src/web/ecb-viewer-parser.ts, which is what the viewer
// actually renders.
//
// Usage:
//   npm run build:cli
//   node dist/timestamps/check.js [--json] [--quiet] \\
//     [--min-syllables-per-sec 1.2] [--max-syllables-per-sec 7] [songs/a.ecb ...]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  formatMarker,
  inlineMarkerTimes,
  isStandaloneMarkerLine,
  parseMarkerSeconds,
  stripInlineMarkers,
} from './ecb-markers';
import { audioCachePath, REPO_ROOT } from './paths';
import { containsCjk, syllableTokens } from './pinyin';

/**
 * Sung Chinese runs roughly 2-4 syllables/sec, but a drawn-out ballad line can
 * sit near 1.2 and a fast rap-ish line above 7. These bounds are deliberately
 * loose: they exist to catch a dropped or duplicated marker, not to grade the
 * arrangement.
 */
export const DEFAULT_MIN_SYLLABLES_PER_SEC = 1.2;
export const DEFAULT_MAX_SYLLABLES_PER_SEC = 7;

/**
 * Markers are whole-second floored (`formatMarker`), so two markers in the same
 * second cannot both be real line starts; this is the near-duplicate window the
 * verifier is required to catch (<0.5s), which with integer markers is only ever
 * reachable at a gap of 0.
 */
const MIN_MARKER_GAP_SEC = 0.5;

/** A marker up to half a second past the ffprobe duration is still the last second. */
const DURATION_SLACK_SEC = 0.5;

export type FindingCode =
  | 'out-of-order'
  | 'duplicate-time'
  | 'out-of-range'
  | 'empty-line-marker'
  | 'syllables-per-sec-low'
  | 'syllables-per-sec-high';

/** One problem found in one file. `line` is 1-based, for editor navigation. */
export interface CheckFinding {
  severity: 'error' | 'warning';
  code: FindingCode;
  line: number;
  message: string;
}

export interface CheckOptions {
  minSyllablesPerSec: number;
  maxSyllablesPerSec: number;
}

export interface FileCheckResult {
  /** Display path, relative to the invocation's cwd. */
  file: string;
  videoId: string | null;
  /** ffprobe duration of the cached audio; null when that bound could not run. */
  durationSec: number | null;
  markerCount: number;
  /** Lyric lines carrying at least one syllable (chord-only lines excluded). */
  lyricLineCount: number;
  anchoredLineCount: number;
  unanchoredLineCount: number;
  findings: CheckFinding[];
  /** Checks that could not run offline, e.g. no cached audio to bound times. */
  notes: string[];
}

interface ParsedSegment {
  /** One entry per `%%languages` slot; '' for a language the segment omits. */
  lyrics: string[];
  /** Marker attached to this segment, in seconds; null when untimed. */
  time: number | null;
}

interface ParsedLyricLine {
  /** 1-based source line number, for messages. */
  lineNumber: number;
  segments: ParsedSegment[];
}

interface ParsedEcb {
  videoId: string | null;
  languages: string[];
  lines: ParsedLyricLine[];
}

interface Marker {
  seconds: number;
  /** 1-based source line number of the enclosing lyric line, for messages. */
  lineNumber: number;
  /** Position of the enclosing lyric line in `ParsedEcb.lines`. */
  linePosition: number;
  /** Position of the marked segment inside that lyric line. */
  segmentIndex: number;
  /** True when the marked segment has no lyric in any language, i.e. a chord run. */
  emptySegment: boolean;
}

/** Reads a single `%%key value` config line; null when the key is absent. */
function readConfig(raw: string, key: string): string | null {
  const match = raw.match(new RegExp(String.raw`^%%${key}\s+(.+)$`, 'm'));
  return match === null ? null : match[1].trim();
}

export function parseEcbForCheck(raw: string): ParsedEcb {
  const languages = (readConfig(raw, 'languages') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const numLanguages = Math.max(1, languages.length);
  const emptyLyrics = (): string[] => new Array<string>(numLanguages).fill('');
  const toLyrics = (text: string): string[] => {
    const parts = text.split('|').map((part) => part.trim());
    while (parts.length < numLanguages) parts.push('');
    return parts;
  };

  const lines: ParsedLyricLine[] = [];
  // Set by a standalone `@M:SS` line, consumed by the next lyric line's first
  // segment, and abandoned by any line in between other than a comment/config.
  let standaloneTime: number | null = null;

  raw.split('\n').forEach((sourceLine, index) => {
    if (sourceLine === '%' || sourceLine.startsWith('% ')) return;
    if (/^%%\S+/.test(sourceLine)) return;

    const trimmed = sourceLine.trim();
    const carried = standaloneTime;
    standaloneTime = null;

    if (isStandaloneMarkerLine(trimmed)) {
      standaloneTime = parseMarkerSeconds(trimmed);
      return;
    }
    if (trimmed === '' || trimmed.startsWith('>') || /^<.+>$/.test(trimmed)) return;
    if (!sourceLine.includes('[')) return;

    const segments: ParsedSegment[] = [];
    let pending: number | null = null;
    let first = true;

    // Text before the first bracket is a chordless segment, and a marker in it
    // annotates the segment that follows, exactly as the viewer pairs them.
    const firstBracket = sourceLine.indexOf('[');
    const leadingRaw = sourceLine.slice(0, firstBracket);
    const leadingTimes = inlineMarkerTimes(leadingRaw);
    const leadingText = stripInlineMarkers(leadingRaw).trim();
    if (leadingTimes.length > 0) pending = leadingTimes[leadingTimes.length - 1];
    if (leadingText !== '') {
      segments.push({ lyrics: toLyrics(leadingText), time: pending ?? (first ? carried : null) });
      first = false;
      pending = null;
    }

    const segmentRe = /\[([^\]]*)\]([^\[]*)/g;
    let match: RegExpExecArray | null;
    while ((match = segmentRe.exec(sourceLine)) !== null) {
      const tailRaw = match[2];
      const times = inlineMarkerTimes(tailRaw);
      const text = stripInlineMarkers(tailRaw).trim();
      segments.push({
        lyrics: text === '' ? emptyLyrics() : toLyrics(text),
        time: pending ?? (first ? carried : null),
      });
      first = false;
      pending = times.length > 0 ? times[times.length - 1] : null;
    }

    if (segments.length > 0) lines.push({ lineNumber: index + 1, segments });
  });

  return { videoId: readConfig(raw, 'youtube'), languages, lines };
}

/**
 * The language track the syllable count is taken from: the first `%%languages`
 * slot that actually carries CJK text, else the first slot. Same choice
 * normalize.ts makes, and it must stay that way -- a pinyin track and a Chinese
 * track have the same syllable count only if the pinyin is well formed.
 */
function primaryLanguageIndex(lines: ParsedLyricLine[], numLanguages: number): number {
  for (let index = 0; index < numLanguages; index++) {
    const hasCjk = lines.some((line) =>
      line.segments.some((segment) => containsCjk(segment.lyrics[index] ?? '')),
    );
    if (hasCjk) return index;
  }
  return 0;
}

/**
 * ffprobe duration of the cached audio for a video. The cache directory is the
 * only offline record of how long a video is, so an absent file (or an
 * unavailable ffprobe) degrades the duration bound to a note instead of a
 * failure: the check must be runnable on a machine that never downloaded audio.
 */
export function probeCachedDuration(videoId: string): { durationSec: number | null; note: string | null } {
  const audioPath = audioCachePath(videoId);
  const display = path.relative(REPO_ROOT, audioPath);
  if (!fs.existsSync(audioPath)) {
    return { durationSec: null, note: `duration bound skipped: no cached audio at ${display}` };
  }
  try {
    const output = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const durationSec = Number.parseFloat(output.trim());
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return { durationSec: null, note: `duration bound skipped: unparsable ffprobe output for ${display}` };
    }
    return { durationSec, note: null };
  } catch (error) {
    return { durationSec: null, note: `duration bound skipped: ffprobe failed on ${display} (${probeFailureReason(error)})` };
  }
}

/** ffprobe's own last stderr line is the useful one; execFileSync's message repeats the whole command. */
function probeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stderr = (error as { stderr?: string | Buffer }).stderr;
  const text = typeof stderr === 'string' ? stderr : (stderr?.toString('utf8') ?? '');
  const lastLine = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .pop();
  if (lastLine !== undefined) return lastLine;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return 'ffprobe not found on PATH';
  return code ?? error.message.split('\n')[0];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Syllables starting at `marker` and ending where `next` starts, counted at line
 * granularity: a mid-line marker skips the segments ahead of it on its own line,
 * and the line the following marker sits on is left to that marker.
 */
function spanSyllables(marker: Marker, next: Marker | null, segmentSyllables: number[][]): number {
  const ownLine = segmentSyllables[marker.linePosition];
  if (next !== null && next.linePosition === marker.linePosition) {
    return sum(ownLine.slice(marker.segmentIndex, next.segmentIndex));
  }
  let total = sum(ownLine.slice(marker.segmentIndex));
  const lastPosition = next === null ? segmentSyllables.length - 1 : next.linePosition - 1;
  for (let position = marker.linePosition + 1; position <= lastPosition; position++) {
    total += sum(segmentSyllables[position]);
  }
  return total;
}

export function checkEcbText(raw: string, file: string, options: CheckOptions): FileCheckResult {
  const parsed = parseEcbForCheck(raw);
  const numLanguages = Math.max(1, parsed.languages.length);
  const primary = primaryLanguageIndex(parsed.lines, numLanguages);
  const notes: string[] = [];
  const findings: CheckFinding[] = [];

  const segmentSyllables: number[][] = parsed.lines.map((line) =>
    line.segments.map((segment) => syllableTokens(segment.lyrics[primary] ?? '').length),
  );

  const markers: Marker[] = [];
  parsed.lines.forEach((line, linePosition) => {
    line.segments.forEach((segment, segmentIndex) => {
      if (segment.time === null) return;
      markers.push({
        seconds: segment.time,
        lineNumber: line.lineNumber,
        linePosition,
        segmentIndex,
        emptySegment: line.segments[segmentIndex].lyrics.every((lyric) => lyric === ''),
      });
    });
  });

  let durationSec: number | null = null;
  if (markers.length > 0) {
    if (parsed.videoId === null) {
      notes.push('duration bound skipped: file has no %%youtube id');
    } else {
      const probe = probeCachedDuration(parsed.videoId);
      durationSec = probe.durationSec;
      if (probe.note !== null) notes.push(probe.note);
    }
  }

  for (let index = 1; index < markers.length; index++) {
    const previous = markers[index - 1];
    const current = markers[index];
    const gap = current.seconds - previous.seconds;
    if (gap < 0) {
      findings.push({
        severity: 'error',
        code: 'out-of-order',
        line: current.lineNumber,
        message:
          `marker ${formatMarker(current.seconds)} comes before ` +
          `${formatMarker(previous.seconds)} on line ${previous.lineNumber}`,
      });
    } else if (gap < MIN_MARKER_GAP_SEC) {
      findings.push({
        severity: 'error',
        code: 'duplicate-time',
        line: current.lineNumber,
        message:
          `marker ${formatMarker(current.seconds)} is ` +
          `${gap === 0 ? 'a repeat of' : `${gap.toFixed(2)}s after`} ` +
          `${formatMarker(previous.seconds)} on line ${previous.lineNumber}`,
      });
    }
  }

  if (durationSec !== null) {
    for (const marker of markers) {
      if (marker.seconds > durationSec + DURATION_SLACK_SEC) {
        findings.push({
          severity: 'error',
          code: 'out-of-range',
          line: marker.lineNumber,
          message: `marker ${formatMarker(marker.seconds)} is past the end of the audio (duration ${durationSec.toFixed(1)}s)`,
        });
      }
    }
  }

  for (const marker of markers) {
    if (!marker.emptySegment) continue;
    findings.push({
      severity: 'warning',
      code: 'empty-line-marker',
      line: marker.lineNumber,
      message: `marker ${formatMarker(marker.seconds)} sits on an empty/instrumental segment, which the viewer cannot highlight`,
    });
  }

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    const next = index + 1 < markers.length ? markers[index + 1] : null;
    const spanEnd = next !== null ? next.seconds : durationSec;
    if (spanEnd === null) {
      notes.push(
        `syllables/sec not checked after ${formatMarker(marker.seconds)} on line ${marker.lineNumber}: ` +
          'no duration bound for the final interval',
      );
      continue;
    }
    const spanSeconds = spanEnd - marker.seconds;
    const syllables = spanSyllables(marker, next, segmentSyllables);
    // A zero-length span is a duplicate already reported above, and a span with
    // no syllables is an instrumental gap already reported as a marker warning.
    if (spanSeconds <= 0 || syllables === 0) continue;
    const rate = syllables / spanSeconds;
    const detail = `${rate.toFixed(2)} syllables/sec over ${spanSeconds.toFixed(1)}s (${syllables} syllables)`;
    if (rate < options.minSyllablesPerSec) {
      findings.push({
        severity: 'warning',
        code: 'syllables-per-sec-low',
        line: marker.lineNumber,
        message: `${detail} is below --min-syllables-per-sec ${options.minSyllablesPerSec}`,
      });
    } else if (rate > options.maxSyllablesPerSec) {
      findings.push({
        severity: 'warning',
        code: 'syllables-per-sec-high',
        line: marker.lineNumber,
        message: `${detail} is above --max-syllables-per-sec ${options.maxSyllablesPerSec}`,
      });
    }
  }

  const anchoredPositions = new Set(markers.map((marker) => marker.linePosition));
  let lyricLineCount = 0;
  let anchoredLineCount = 0;
  segmentSyllables.forEach((lineSyllables, position) => {
    if (sum(lineSyllables) === 0) return;
    lyricLineCount += 1;
    if (anchoredPositions.has(position)) anchoredLineCount += 1;
  });

  findings.sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  return {
    file,
    videoId: parsed.videoId,
    durationSec,
    markerCount: markers.length,
    lyricLineCount,
    anchoredLineCount,
    unanchoredLineCount: lyricLineCount - anchoredLineCount,
    findings,
    notes,
  };
}

interface CliOptions extends CheckOptions {
  json: boolean;
  quiet: boolean;
  paths: string[];
}

const USAGE = [
  'Usage: node dist/timestamps/check.js [options] [songs/a.ecb ...]',
  '',
  'Verifies the @M:SS markers of the given .ecb files (default: every songs/*.ecb).',
  '',
  '  --json                     Print a machine-readable report instead of text.',
  '  --min-syllables-per-sec N  Low plausibility bound (default 1.2).',
  '  --max-syllables-per-sec N  High plausibility bound (default 7).',
  '  --quiet                    Print hard errors only.',
  '',
  'Exit codes: 0 when only warnings were found, 1 on hard errors (ordering,',
  'duplicate times, markers past the end of the cached audio), 2 on bad usage.',
].join('\n');

class UsageError extends Error {}

function splitFlag(argument: string): [string, string | undefined] {
  const equals = argument.indexOf('=');
  return equals === -1
    ? [argument, undefined]
    : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    quiet: false,
    minSyllablesPerSec: DEFAULT_MIN_SYLLABLES_PER_SEC,
    maxSyllablesPerSec: DEFAULT_MAX_SYLLABLES_PER_SEC,
    paths: [],
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '') continue;
    if (!argument.startsWith('--')) {
      options.paths.push(argument);
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--quiet') {
      options.quiet = true;
      continue;
    }

    const [flag, inlineValue] = splitFlag(argument);
    if (flag !== '--min-syllables-per-sec' && flag !== '--max-syllables-per-sec') {
      throw new UsageError(`unknown flag '${argument}'\n\n${USAGE}`);
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined) throw new UsageError(`${flag} needs a number`);
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new UsageError(`${flag} needs a positive number, got '${value}'`);
    }
    if (flag === '--min-syllables-per-sec') options.minSyllablesPerSec = parsed;
    else options.maxSyllablesPerSec = parsed;
  }

  if (options.minSyllablesPerSec >= options.maxSyllablesPerSec) {
    throw new UsageError('--min-syllables-per-sec must be less than --max-syllables-per-sec');
  }
  return options;
}

function displayPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative === '' ? absolutePath : relative;
}

/** Every `songs/*.ecb`, sorted, so a bare run is reproducible. */
function defaultSongPaths(): string[] {
  const songsDir = path.join(REPO_ROOT, 'songs');
  return fs
    .readdirSync(songsDir)
    .filter((name) => name.endsWith('.ecb'))
    .sort()
    .map((name) => path.join(songsDir, name));
}

function countSeverity(results: FileCheckResult[], severity: CheckFinding['severity']): number {
  return results.reduce(
    (total, result) => total + result.findings.filter((finding) => finding.severity === severity).length,
    0,
  );
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function renderText(results: FileCheckResult[], quiet: boolean): string {
  const lines: string[] = [];
  for (const result of results) {
    if (quiet) {
      for (const finding of result.findings) {
        if (finding.severity !== 'error') continue;
        lines.push(`${result.file}: line ${finding.line}: ${finding.message}`);
      }
      continue;
    }
    lines.push(`${result.file}  (video: ${result.videoId ?? 'none'})`);
    lines.push(
      `  markers: ${result.markerCount}, sung lines: ${result.lyricLineCount}, ` +
        `un-anchored: ${result.unanchoredLineCount}`,
    );
    for (const note of result.notes) lines.push(`  note: ${note}`);
    for (const finding of result.findings) {
      lines.push(`  ${finding.severity} line ${finding.line}: ${finding.message}`);
    }
  }

  if (quiet) return lines.join('\n');

  const errors = countSeverity(results, 'error');
  const warnings = countSeverity(results, 'warning');
  lines.push('');
  lines.push(
    `Checked ${results.length} ${plural(results.length, 'file')}: ` +
      `${errors} ${plural(errors, 'error')}, ${warnings} ${plural(warnings, 'warning')}.`,
  );
  return lines.join('\n');
}

function main(argv: string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const targets = options.paths.length > 0 ? options.paths : defaultSongPaths();
  const missing = targets.filter((target) => !fs.existsSync(target));
  if (missing.length > 0) {
    for (const target of missing) console.error(`no such file: ${target}`);
    return 2;
  }

  const results = targets.map((target) =>
    checkEcbText(fs.readFileSync(target, 'utf8'), displayPath(path.resolve(target)), options),
  );

  if (options.json) {
    const errors = countSeverity(results, 'error');
    const warnings = countSeverity(results, 'warning');
    console.log(JSON.stringify({ files: results, summary: { files: results.length, errors, warnings } }, null, 2));
  } else {
    const text = renderText(results, options.quiet);
    if (text !== '') console.log(text);
  }

  return countSeverity(results, 'error') > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
