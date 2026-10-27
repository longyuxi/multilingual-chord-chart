// Offline golden test for the timestamp pipeline (tab-pinyinizer-ilg.8).
//
// songs/condensed_blue_whale.ecb is the only ground truth in this repo: 8
// markers a human placed by ear over ~70 lyric lines. That makes it the cheapest
// falsifiable check on the harness before trusting it on songs nobody has
// checked. A pipeline run rewrites a file's markers (docs/timestamps-contract.md,
// "Emission is idempotent and single-owner"), so the hand-made set survives only
// in git history -- `git show d0a87ee:songs/condensed_blue_whale.ecb`, the commit
// that added them, before marker emission could overwrite them.
//
// The run is offline and deterministic: it replays the real pipeline
// (normalize.ts -> align.ts -> ecb-timestamps.ts) against the committed whisper-1
// asr.json fixture under src/timestamps/__fixtures__/asr/, reads the song from
// disk without writing it back, needs no API key, and makes no network call. The
// working-tree copy of the song may already carry pipeline-written markers (a
// real run rewrites songs/*); that changes nothing here, because emission strips
// every marker before re-inserting and the hand set comes from git.
//
// It is a gate, not a report: exit 0 when the epic's bar (at least 7 of the 8
// hand markers within --tolerance) is met, 1 when it is not, 2 when the check
// itself could not run. Today's corroboration fixture fails the bar, and that is
// the honest, expected outcome -- the numbers are printed as they are, because
// tuning the aligner until this fixture passes would fit whisper-1's onset bias
// instead of the song.
//
// Usage:
//   npm run build:cli
//   npm run golden-timestamps -- [--fixture PATH] [--tolerance S] [--report-only] [--json]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { alignLines } from './align';
import {
  findStandaloneMarkers,
  formatMarker,
  inlineMarkerTimes,
  isStandaloneMarkerLine,
  parseMarkerSeconds,
} from './ecb-markers';
import { emitMarkers } from './ecb-timestamps';
import { normalizeLyrics } from './normalize';
import { REPO_ROOT } from './paths';
import type { AsrResult, NormalizedLyrics } from './types';

/** The one song with hand-placed markers; repo-relative, and the path `git show` reads. */
const GOLDEN_SONG = 'songs/condensed_blue_whale.ecb';

/**
 * Commit that added the 8 hand-made markers, before ilg.5 could replace them
 * (`git show <ref>:songs/condensed_blue_whale.ecb`). Pinned to a hash because the
 * working-tree file's markers are the pipeline's to rewrite.
 */
const HAND_MARKER_REF = 'd0a87ee';

/** Committed whisper-1 `asr.json`, so the run costs nothing and never varies. */
const DEFAULT_FIXTURE = path.join(REPO_ROOT, 'src', 'timestamps', '__fixtures__', 'asr', 'cbs-whisper-1.json');

/**
 * tab-pinyinizer-ilg.8's acceptance criterion: at least 7 of the 8 hand markers
 * reproduced within 1.5s. 1.5s is roughly a bar of music at these tempos -- a
 * wrong line shows up as a much larger error than that, so this distinguishes
 * "off by an onset" from "aligned to the wrong line".
 */
const DEFAULT_TOLERANCE_SEC = 1.5;
const BAR_MIN_MATCHES = 7;

interface CliOptions {
  fixture: string;
  toleranceSec: number;
  /** `--report-only`: print the numbers and exit 0 whatever the bar says. */
  reportOnly: boolean;
  json: boolean;
  help: boolean;
}

const USAGE = [
  'Usage: npm run golden-timestamps -- [options]',
  '',
  'Re-runs the timestamp pipeline on songs/condensed_blue_whale.ecb against the',
  'committed whisper-1 asr.json fixture (no provider call, no API key, no network)',
  'and compares the emitted markers with the 8 hand-made markers extracted from',
  `git (${HAND_MARKER_REF}:${GOLDEN_SONG}).`,
  '',
  'Options:',
  `  --fixture PATH   asr.json to align against (default: the committed whisper-1`,
  '                   fixture).',
  `  --tolerance S    Seconds a marker may differ and still count (default ${DEFAULT_TOLERANCE_SEC}).`,
  '  --report-only    Print the table and summary, always exit 0.',
  '  --json           Print a machine-readable report on stdout.',
  '  --help           Print this text.',
  '',
  `Exit codes: 0 bar met (at least ${BAR_MIN_MATCHES} of ${BAR_MIN_MATCHES + 1} hand markers within tolerance)`,
  'or --report-only, 1 bar not met, 2 the check itself could not run (bad usage,',
  'missing fixture, or the hand-marker commit missing from git history).',
].join('\n');

class UsageError extends Error {}

/** One hand-made marker, with the lyric line it annotates. */
interface HandMarker {
  seconds: number;
  /** Line index of the annotated lyric line in the historical file. */
  lineIndex: number;
  /** Marker-free primary-language text of that line; '' when it is not a lyric line. */
  lyric: string;
  /**
   * What the marker annotates. `line` markers lead their lyric line, which is
   * exactly what emitMarkers produces, so they are compared line to line.
   * `segment` markers sit mid-line (the hand `@1:52` annotates the `何` segment
   * of `[C]卷起 ... [C]何`); a one-marker-per-line emitter has no counterpart to
   * pair them with, so they are compared against the nearest emitted marker and
   * the row says so rather than silently reading as a 2s misalignment.
   */
  scope: 'line' | 'segment';
}

interface HandMarkerSet {
  markers: HandMarker[];
  /** `contentKeys` over the historical file, since its line numbers are stale. */
  keys: Map<number, string>;
}

/** One marker the pipeline emitted, and the lyric line it sits above. */
interface GeneratedMarker {
  seconds: number;
  /** Line index of the annotated lyric line in the emitted text. */
  lineIndex: number;
}

interface MarkerComparison {
  hand: HandMarker;
  generated: GeneratedMarker | null;
  /** `generated - hand`; positive means the generated marker is later. */
  deltaSec: number | null;
  withinTolerance: boolean;
  /** Nearest generated marker in time, for telling a pairing bug from an onset bias. */
  nearestDeltaSec: number | null;
  /** Why this row could not be paired; absent when it was. */
  problem?: string;
  /** `segment` rows are matched by nearest time, not by line. */
  pairing: 'line' | 'segment';
}

export interface GoldenResult {
  song: string;
  handRef: string;
  fixture: string;
  provider: string;
  model: string;
  source: string;
  tokenCount: number;
  durationSec: number;
  toleranceSec: number;
  emittedMarkers: number;
  /** Hand-authored inline markers the emission replaced (single-owner rule). */
  replacedInlineMarkers: number;
  unanchoredLines: number;
  rows: MarkerComparison[];
  handMarkers: number;
  withinTolerance: number;
  nearestWithinTolerance: number;
  medianAbsDeltaSec: number | null;
  maxAbsDeltaSec: number | null;
  barMinMatches: number;
  barMet: boolean;
}

function splitFlag(argument: string): [string, string | undefined] {
  const equals = argument.indexOf('=');
  return equals === -1
    ? [argument, undefined]
    : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fixture: DEFAULT_FIXTURE,
    toleranceSec: DEFAULT_TOLERANCE_SEC,
    reportOnly: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '') continue;
    if (argument === '--report-only') {
      options.reportOnly = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new UsageError(`unexpected argument '${argument}'`);

    const [flag, inlineValue] = splitFlag(argument);
    if (flag !== '--fixture' && flag !== '--tolerance') {
      throw new UsageError(`unknown flag '${argument}'`);
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined) throw new UsageError(`${flag} needs a value`);
    if (flag === '--fixture') {
      options.fixture = path.resolve(value);
      continue;
    }
    const tolerance = Number.parseFloat(value);
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new UsageError(`--tolerance needs a positive number of seconds, got '${value}'`);
    }
    options.toleranceSec = tolerance;
  }

  return options;
}

function displayPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative === '' || relative.startsWith('..') ? absolutePath : relative;
}

/** Last stderr line of a failed child process is the useful one. */
function childFailureReason(error: unknown): string {
  const stderr = (error as { stderr?: string | Buffer }).stderr;
  const text = typeof stderr === 'string' ? stderr : (stderr?.toString('utf8') ?? '');
  const lastLine = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .pop();
  if (lastLine !== undefined) return lastLine;
  return (error as Error).message.split('\n')[0];
}

/**
 * Line content -> identity key, so a hand marker can be paired with a generated
 * one after the file has been edited around it (the historical version predates
 * the english track, so its line numbers mean nothing today). Whitespace is part
 * of the key's *noise*, not its content: normalize.ts joins a line's segments with
 * a space, so a translation track that merges two segments into one changes
 * `给 我回应` to `给我回应` without changing a single sung character.
 *
 * The nth occurrence of a text is the nth line with that key, because a repeated
 * chorus line is only distinguishable by which repetition it is.
 */
function contentKeys(lyrics: NormalizedLyrics): Map<number, string> {
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  for (const line of lyrics.lines) {
    const text = line.text.replace(/\s+/g, '');
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    keys.set(line.lineIndex, `${text}\u0000${occurrence}`);
  }
  return keys;
}

/**
 * The markers a human placed, read from git history and paired with the lyric
 * lines they annotate.
 *
 * A standalone marker annotates the lyric line directly below it; an inline
 * marker annotates the segment that follows it (check.ts and the viewer pair them
 * the same way), which at line granularity is the line the marker sits in --
 * including the hand-written `@2:06 请|qing...`, where the marker leads its own
 * line.
 */
function readHandMarkers(ref: string): HandMarkerSet {
  let raw: string;
  try {
    raw = execFileSync('git', ['show', `${ref}:${GOLDEN_SONG}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(
      `could not read the hand-made markers from git (git show ${ref}:${GOLDEN_SONG}): ` +
        `${childFailureReason(error)}. They exist only in history because a pipeline run ` +
        'rewrites a file\'s markers; a shallow clone without that commit cannot run this check.',
    );
  }

  const handLyrics = normalizeLyrics(raw);
  const textByLine = new Map(handLyrics.lines.map((line) => [line.lineIndex, line.text]));
  const lyricAt = (lineIndex: number): string => textByLine.get(lineIndex) ?? '';

  const markers: HandMarker[] = [];
  raw.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (isStandaloneMarkerLine(trimmed)) {
      const target = index + 1;
      markers.push({
        seconds: parseMarkerSeconds(trimmed),
        lineIndex: target,
        lyric: lyricAt(target),
        scope: 'line',
      });
      return;
    }
    const times = inlineMarkerTimes(line);
    if (times.length === 0) return;
    // Only the last inline marker on a segment is the one the grammar binds to the
    // text that follows; the others would need segment-level pairing to mean
    // anything, and the golden song has exactly one.
    //
    // A marker with no chord/lyric text before it on its line leads the line
    // (`@2:06 请|qing...`), so it annotates the line; anything stricter than the
    // first segment of a line is segment-scoped.
    const markerAt = (() => {
      let at = -1;
      for (const match of line.matchAll(/@\d+(?::\d+){0,2}/g)) at = match.index ?? at;
      return at;
    })();
    const beforeMarker = markerAt > 0 ? line.slice(0, markerAt) : '';
    markers.push({
      seconds: times[times.length - 1],
      lineIndex: index,
      lyric: lyricAt(index),
      scope: beforeMarker.trim() === '' ? 'line' : 'segment',
    });
  });

  if (markers.length === 0) {
    throw new Error(
      `no @M:SS markers in ${ref}:${GOLDEN_SONG}; ` +
        'the pinned hand-marker commit looks wrong',
    );
  }
  return { markers, keys: contentKeys(handLyrics) };
}

function readFixture(file: string): AsrResult {
  if (!fs.existsSync(file)) throw new Error(`no such fixture: ${file}`);
  let parsed: AsrResult;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AsrResult;
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed.tokens) || parsed.tokens.length === 0) {
    throw new Error(`${file} carries no tokens, so there is nothing to align against`);
  }
  if (typeof parsed.videoId !== 'string' || typeof parsed.durationSec !== 'number') {
    throw new Error(`${file} is not an AsrResult (missing videoId or durationSec)`);
  }
  return parsed;
}

interface GeneratedMarkerSet {
  markers: GeneratedMarker[];
  /** `contentKeys` over the emitted text, for pairing against the hand set. */
  keys: Map<number, string>;
}

/** Every emitted marker with the lyric line it sits above, in file order. */
function readGeneratedMarkers(emittedText: string): GeneratedMarkerSet {
  const lyrics = normalizeLyrics(emittedText);
  const textByLine = new Map(lyrics.lines.map((line) => [line.lineIndex, line.text]));
  const markers: GeneratedMarker[] = [];
  for (const marker of findStandaloneMarkers(emittedText)) {
    const target = marker.lineIndex + 1;
    // emitMarkers inserts the marker directly above its lyric line, so a marker
    // with no lyric line below it means emission and normalization disagree about
    // what a lyric line is -- a bug here, not something to skip quietly.
    if (!textByLine.has(target)) {
      throw new Error(`emitted marker ${marker.label} on line ${marker.lineIndex + 1} has no lyric line below it`);
    }
    markers.push({ seconds: marker.seconds, lineIndex: target });
  }
  return { markers, keys: contentKeys(lyrics) };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Round-trip to the millisecond, so the report does not print float noise. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function runGolden(options: CliOptions): GoldenResult {
  const songPath = path.join(REPO_ROOT, GOLDEN_SONG);
  const rawEcb = fs.readFileSync(songPath, 'utf8');
  const asr = readFixture(options.fixture);

  const normalized = normalizeLyrics(rawEcb);
  if (normalized.videoId !== asr.videoId) {
    // Aligning one video's lyrics against another's audio produces a plausible
    // number for the wrong song, which is worse than no number at all.
    throw new Error(
      `fixture is for video ${asr.videoId} but ${GOLDEN_SONG} embeds ${normalized.videoId ?? '(none)'}`,
    );
  }

  const hand = readHandMarkers(HAND_MARKER_REF);
  const handMarkers = hand.markers;

  // The real pipeline, minus the provider call: the fixture stands in for
  // createAsrClient (same AsrResult shape), so normalize -> align -> emit run
  // exactly as `npm run timestamps` runs them.
  const report = alignLines(normalized, asr);
  const emitted = emitMarkers(rawEcb, report);

  const generatedSets = readGeneratedMarkers(emitted.text);
  const generatedMarkers = generatedSets.markers;

  const generatedByKey = new Map<string, GeneratedMarker>();
  for (const marker of generatedMarkers) {
    const key = generatedSets.keys.get(marker.lineIndex);
    if (key !== undefined && !generatedByKey.has(key)) generatedByKey.set(key, marker);
  }

  const rows: MarkerComparison[] = handMarkers.map((marker) => {
    const key = hand.keys.get(marker.lineIndex);
    const nearest = nearestMarker(generatedMarkers, marker.seconds);
    const nearestDeltaSec = nearest === null ? null : round3(nearest.seconds - marker.seconds);
    if (marker.lyric === '') {
      return {
        hand: marker,
        generated: null,
        deltaSec: null,
        withinTolerance: false,
        nearestDeltaSec,
        problem: 'the marker does not annotate a lyric line',
        pairing: marker.scope,
      };
    }
    const generated = marker.scope === 'segment' ? nearest ?? undefined : key === undefined ? undefined : generatedByKey.get(key);
    if (generated === undefined) {
      return {
        hand: marker,
        generated: null,
        deltaSec: null,
        withinTolerance: false,
        nearestDeltaSec,
        problem: 'no generated marker on this lyric line',
        pairing: marker.scope,
      };
    }
    const deltaSec = round3(generated.seconds - marker.seconds);
    return {
      hand: marker,
      generated,
      deltaSec,
      withinTolerance: Math.abs(deltaSec) <= options.toleranceSec,
      nearestDeltaSec,
      pairing: marker.scope,
    };
  });

  const deltas = rows
    .map((row) => row.deltaSec)
    .filter((delta): delta is number => delta !== null)
    .map(Math.abs);
  const withinTolerance = rows.filter((row) => row.withinTolerance).length;
  const nearestWithinTolerance = rows.filter(
    (row) => row.nearestDeltaSec !== null && Math.abs(row.nearestDeltaSec) <= options.toleranceSec,
  ).length;

  return {
    song: GOLDEN_SONG,
    handRef: HAND_MARKER_REF,
    fixture: displayPath(options.fixture),
    provider: asr.provider,
    model: asr.model,
    source: asr.source,
    tokenCount: asr.tokens.length,
    durationSec: asr.durationSec,
    toleranceSec: options.toleranceSec,
    emittedMarkers: emitted.inserted,
    replacedInlineMarkers: emitted.staleInlineMarkers,
    unanchoredLines: report.unanchored.length,
    rows,
    handMarkers: handMarkers.length,
    withinTolerance,
    nearestWithinTolerance,
    medianAbsDeltaSec: median(deltas),
    maxAbsDeltaSec: deltas.length === 0 ? null : Math.max(...deltas),
    barMinMatches: BAR_MIN_MATCHES,
    barMet: withinTolerance >= BAR_MIN_MATCHES,
  };
}

/** Generated marker closest in time to `seconds`; ties keep the earlier one. */
function nearestMarker(markers: GeneratedMarker[], seconds: number): GeneratedMarker | null {
  let best: GeneratedMarker | null = null;
  for (const marker of markers) {
    if (best === null || Math.abs(marker.seconds - seconds) < Math.abs(best.seconds - seconds)) {
      best = marker;
    }
  }
  return best;
}

/** `+1.2s` / `-2.0s` / `0.0s` -- the sign says which way the generated marker sits. */
function formatDelta(seconds: number): string {
  const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : '';
  return `${sign}${Math.abs(seconds).toFixed(1)}s`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

/**
 * The human report. Plain text everywhere -- no ANSI even on a TTY -- so a pipe,
 * a log and a terminal all get bytes a human can diff between runs.
 */
function renderText(result: GoldenResult): string {
  const lines: string[] = [];
  const barText = `${result.barMinMatches} of ${result.handMarkers}`;

  lines.push(`Golden timestamps: ${result.song}`);
  lines.push(
    `  hand markers  ${result.handMarkers}, from git ${result.handRef}:${result.song} ` +
      '(pre-pipeline; paired by lyric line content)',
  );
  lines.push(
    `  fixture       ${result.fixture} (${result.provider}/${result.model}, ${result.source} audio, ` +
      `${result.tokenCount} tokens over ${result.durationSec.toFixed(1)}s)`,
  );
  lines.push(
    `  pipeline      ${result.emittedMarkers} markers emitted, ` +
      `${result.replacedInlineMarkers} hand-made inline marker(s) replaced, ` +
      `${result.unanchoredLines} unanchored lines`,
  );
  lines.push(`  tolerance     ${result.toleranceSec}s (delta = generated - hand)`);
  lines.push('');

  lines.push(
    `  ${pad('hand', 8)}${pad('generated', 11)}${pad('delta', 8)}${pad('verdict', 9)}` +
      `${pad('nearest', 9)}lyric line`,
  );
  for (const row of result.rows) {
    const handLabel = formatMarker(row.hand.seconds);
    const generatedLabel = row.generated === null ? '--' : formatMarker(row.generated.seconds);
    const delta = row.deltaSec === null ? '--' : formatDelta(row.deltaSec);
    const verdict = row.withinTolerance ? 'ok' : row.problem === undefined ? 'MISS' : 'UNPAIRED';
    const nearest = row.nearestDeltaSec === null ? '--' : formatDelta(row.nearestDeltaSec);
    const lyric =
      row.problem !== undefined
        ? `${row.hand.lyric}  (${row.problem})`
        : row.pairing === 'segment'
          ? `${row.hand.lyric}  (segment-anchored: nearest emitted marker)`
          : row.hand.lyric;
    lines.push(
      `  ${pad(handLabel, 8)}${pad(generatedLabel, 11)}${pad(delta, 8)}${pad(verdict, 9)}` +
        `${pad(nearest, 9)}${lyric}`,
    );
  }

  lines.push('');
  lines.push('Summary');
  lines.push(
    `  ${result.withinTolerance} of ${result.handMarkers} hand markers within ${result.toleranceSec}s ` +
      `(bar: at least ${barText}) -- ${result.barMet ? 'MET (exit 0)' : 'NOT MET (exit 1)'}`,
  );
  lines.push(
    `  nearest-in-time ${result.nearestWithinTolerance} of ${result.handMarkers} within ` +
      `${result.toleranceSec}s: same-song sanity check, so a large paired delta next to a small ` +
      'nearest delta is a pairing problem, not an onset bias',
  );
  const medianText = result.medianAbsDeltaSec === null ? '--' : `${result.medianAbsDeltaSec.toFixed(1)}s`;
  const maxText = result.maxAbsDeltaSec === null ? '--' : `${result.maxAbsDeltaSec.toFixed(1)}s`;
  lines.push(`  median |delta| ${medianText}, max |delta| ${maxText}`);
  lines.push('');

  lines.push('Notes');
  if (result.provider === 'whisper-1') {
    lines.push(
      '  the fixture is whisper-1, the corroboration stream, not the target: its word onsets run',
    );
    lines.push(
      '  late, and ElevenLabs forced alignment (the intended primary source) is expected to land',
    );
    lines.push('  closer to the hand markers.');
  } else {
    lines.push(
      `  the fixture is ${result.provider}/${result.model}; whisper-1 is the independent`,
    );
    lines.push('  corroboration stream, so the two should be compared before trusting either.');
  }
  lines.push(
    '  the pipeline is not tuned to this fixture: it reports what the aligner produces, and the',
  );
  lines.push(
    '  gate is the signal. --tolerance S moves the bar (a looser tolerance shows whether the',
  );
  lines.push(
    '  misses are small onset errors or misalignment); --report-only always exits 0.',
  );
  return lines.join('\n');
}

function renderJson(result: GoldenResult): string {
  return JSON.stringify(
    {
      song: result.song,
      handMarkerRef: result.handRef,
      fixture: result.fixture,
      fixtureInfo: {
        provider: result.provider,
        model: result.model,
        source: result.source,
        tokens: result.tokenCount,
        durationSec: result.durationSec,
      },
      toleranceSec: result.toleranceSec,
      emitted: {
        markers: result.emittedMarkers,
        replacedInlineMarkers: result.replacedInlineMarkers,
        unanchoredLines: result.unanchoredLines,
      },
      markers: result.rows.map((row) => ({
        hand: formatMarker(row.hand.seconds),
        handSeconds: row.hand.seconds,
        generated: row.generated === null ? null : formatMarker(row.generated.seconds),
        generatedSeconds: row.generated === null ? null : row.generated.seconds,
        deltaSec: row.deltaSec,
        nearestDeltaSec: row.nearestDeltaSec,
        withinTolerance: row.withinTolerance,
        lyric: row.hand.lyric,
        problem: row.problem ?? null,
      })),
      summary: {
        handMarkers: result.handMarkers,
        withinTolerance: result.withinTolerance,
        nearestWithinTolerance: result.nearestWithinTolerance,
        medianAbsDeltaSec: result.medianAbsDeltaSec,
        maxAbsDeltaSec: result.maxAbsDeltaSec,
        bar: { minMatches: result.barMinMatches, met: result.barMet },
      },
    },
    null,
    2,
  );
}

function main(argv: string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  let result: GoldenResult;
  try {
    result = runGolden(options);
  } catch (error) {
    console.error(`[golden] ${(error as Error).message}`);
    return 2;
  }

  console.log(options.json ? renderJson(result) : renderText(result));
  // --report-only exists because a human comparing two fixtures (whisper-1 vs
  // ElevenLabs) wants both tables before acting, not a stop at the first failure.
  if (options.reportOnly) return 0;
  return result.barMet ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
