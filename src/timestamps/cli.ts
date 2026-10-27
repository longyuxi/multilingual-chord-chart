// Orchestration for `npm run timestamps` (tab-pinyinizer-ilg.6): the one entry
// point an agent or human re-runs over a single song or the whole catalog.
//
// Every stage stays in its own module (docs/timestamps-contract.md); this file
// only sequences them per song -- audio.prepareAudio -> normalize.normalizeLyrics
// -> providers.createAsrClient -> alignLines -> [repair.repairTimestamps, when
// --repair is set and lines were flagged] -> ecb-timestamps.emitMarkers -> write
// -- so a stage can be replaced without touching the CLI. The repair pass never
// edits the file: it returns a patch that repair.ts has already validated, and
// the markers emitted from the patched report are what gets written.
//
// Songs are independent, so they are processed sequentially (providers rate
// limit, and one song's failure must not abort the rest) and a partial run is
// always safe. A song without `%%youtube` is skipped with a message and exit
// code 0, never an error.
//
// Usage:
//   npm run build:cli
//   npm run timestamps -- [options] [songs/a.ecb ...]
//   npm run timestamps -- --all --dry-run --assume-duration 240

import * as fs from 'fs';
import * as path from 'path';

import { alignLines } from './align';
import { parseYoutubeId, prepareAudio, probeDurationSec } from './audio';
import { checkEcbText, DEFAULT_MAX_SYLLABLES_PER_SEC, DEFAULT_MIN_SYLLABLES_PER_SEC } from './check';
import { emitMarkers, renderMarkerDiff } from './ecb-timestamps';
import type { ApiKeyName } from './env';
import { hasApiKey, requireApiKey } from './env';
import { normalizeLyrics } from './normalize';
import { audioCachePath, asrCachePath, readAsrCache, REPO_ROOT } from './paths';
import type { AsrCacheKey } from './paths';
import type { PaidAsrProvider } from './providers';
import { PAID_ASR_PROVIDERS, asrProviderInfo, createAsrClient } from './providers';
import { DEFAULT_MAX_SHIFT_SEC, createOpenAiProposer, repairModel, repairTimestamps } from './repair';
import type { RepairChange, RepairProposer } from './repair';
import type { AlignReport, AsrProvider, AudioSource, StemsMode } from './types';

const LOG_PREFIX = '[timestamps]';

/** Paid provider -> the credential its adapter reads (providers/*.ts). */
const PROVIDER_API_KEY: Record<PaidAsrProvider, ApiKeyName> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  'whisper-1': 'OPENAI_API_KEY',
};

/**
 * The stem a v1 run sends to the provider. `--stems` is accepted and validated
 * so existing invocations keep working once the demucs pass (ilg.12) lands, but
 * nothing demixes yet: every run uses the cached `raw` audio, and `--stems
 * always` therefore means the same thing as `never` today.
 */
const V1_AUDIO_SOURCE: AudioSource = 'raw';

/**
 * Cost model for the bounded patch pass (`--repair`, ilg.10), used by
 * `--dry-run` only. Prices are OpenAI's list prices for gpt-4o-mini -- the
 * default `TIMESTAMP_REPAIR_MODEL` -- as published on
 * https://platform.openai.com/docs/pricing (US$0.15 per Mtok input, US$0.60 per
 * Mtok output). They are per *flagged* line, and the planner prices every lyric
 * line as if it were flagged, so the estimate is an upper bound. A changed model
 * (env var) or a changed prompt (`prompts/fix_timestamps.md`, which is counted
 * once per song) moves this number; re-derive it from the token counts below
 * rather than trusting the rounding.
 */
const REPAIR_INPUT_TOKENS_PER_LINE = 200;
const REPAIR_OUTPUT_TOKENS_PER_LINE = 20;
const REPAIR_INPUT_USD_PER_MTOK = 0.15;
const REPAIR_OUTPUT_USD_PER_MTOK = 0.6;

type Density = 'every-line' | 'sparse';

type SongStatus = 'written' | 'unchanged' | 'skipped' | 'failed' | 'dry-run';

/** `--dry-run`'s costing of one song. No call is made to produce it. */
export interface CostEstimate {
  durationSec: number;
  /** `cache` = ffprobe of audio already on disk; `assumed` = --assume-duration. */
  durationSource: 'cache' | 'assumed';
  pricePerHourUsd: number;
  asrCostUsd: number;
  /** Lyric lines the repair estimate was priced over; 0 without --repair. */
  repairLines: number;
  /** Model the repair estimate is priced for (`TIMESTAMP_REPAIR_MODEL`). */
  repairModel?: string;
  repairCostUsd: number;
  totalUsd: number;
}

/**
 * One song's outcome. `--json` prints these one per line on stdout; the text
 * mode renders the same facts for a human.
 */
export interface SongResult {
  file: string;
  status: SongStatus;
  videoId?: string;
  provider?: AsrProvider;
  model?: string;
  durationSec?: number;
  /** Lyric lines that received a marker. */
  inserted?: number;
  /** Hand-authored inline markers removed so the emitted set stays single-owner. */
  staleInlineMarkers?: number;
  /** Anchored lines thinned out by --min-gap/--density or a duplicate second. */
  markersSkipped?: number;
  /** Lines the aligner flagged (drives the repair pass). */
  flagged?: number;
  /** Lines --repair actually moved or dropped. */
  repaired?: number;
  /** The repair model's own notes, when it was consulted. */
  repairNotes?: string;
  unanchored?: number;
  estimate?: CostEstimate;
  report?: AlignReport;
  /** One-line explanation for `skipped`, or the exception message for `failed`. */
  message?: string;
}

interface CliOptions {
  paths: string[];
  all: boolean;
  provider: PaidAsrProvider;
  stems: StemsMode;
  density: Density;
  /** Explicit gap in seconds; undefined falls back to the density preset. */
  minGap?: number;
  padStart: number;
  repair: boolean;
  /** --repair-max-shift: largest move the repair patch may make, in seconds. */
  repairMaxShift: number;
  /**
   * The model call, set once in main() and never from argv: a live proposer for
   * a real --repair run, an injected one for offline tests, and undefined when
   * --repair is off or --dry-run may not spend (see `runTimestampsCli`).
   */
  repairProposer?: RepairProposer;
  dryRun: boolean;
  force: boolean;
  json: boolean;
  /** --assume-duration: duration for songs whose audio is not cached yet. */
  assumeDurationSec?: number;
  help: boolean;
}

const USAGE = [
  'Usage: npm run timestamps -- [options] [songs/a.ecb ...]',
  '',
  'Aligns each song\'s lyrics to its embedded YouTube audio and writes standalone',
  '@M:SS marker lines into the .ecb file. Songs are processed one at a time; a',
  'failure is reported and the run continues. Songs without %%youtube are skipped',
  '(exit 0). Re-running on an already-timestamped file leaves it byte-identical.',
  '',
  'Targets:',
  '  songs/a.ecb ...            One or more .ecb paths (default: none -- pass',
  '                             --all or explicit paths).',
  '  --all                      Every songs/*.ecb.',
  '',
  'Options:',
  '  --provider NAME            elevenlabs (default, scribe_v1 forced alignment)',
  '                             or whisper-1 (independent corroboration).',
  '  --stems MODE               auto | always | never (default auto). Accepted and',
  '                             validated, but NOT yet wired to anything: v1 never',
  '                             runs a demucs pass and always times the raw audio,',
  '                             so auto/always/never all behave like never today.',
  '  --density MODE             every-line (default) or sparse (~1 marker / 12s,',
  '                             the hand-made style of condensed_blue_whale.ecb).',
  '  --min-gap N                Minimum seconds between markers (overrides the',
  '                             --density preset; 0 = every anchored line).',
  '  --pad-start S              Seconds added to every marker before flooring, for',
  '                             a known lead-in. May be negative. Default 0.',
  '  --repair                   After aligning, send only the flagged lines (plus a',
  '                             +/-5s window of raw ASR tokens around each) to the',
  '                             repair model, which may move one of them or drop',
  '                             it as unsung. Its patch is validated in code --',
  '                             unknown/unflagged lines, over-large moves and a',
  '                             broken timeline are rejected with a reason and',
  '                             nothing is written. A song with no flagged lines',
  '                             makes no call at all. Needs OPENAI_API_KEY; model',
  '                             from TIMESTAMP_REPAIR_MODEL (default',
  '                             gpt-4o-mini).',
  '  --repair-max-shift S       Largest move --repair may make to a line\'s start,',
  '                             in seconds (default 5). It is also the radius of',
  '                             the token window the model is shown, so a patch',
  '                             can never point outside its own evidence.',
  '  --dry-run                  Report audio duration x provider price (plus an',
  '                             LLM repair estimate) and spend nothing. Uses the',
  '                             cached audio for duration; a song with no cached',
  '                             audio needs --assume-duration. Never downloads and',
  '                             never calls a provider. With --repair it also',
  '                             previews the repair pass from cached audio/ASR',
  '                             and prints the diff it would write, without',
  '                             consulting the repair model.',
  '  --assume-duration S        Duration used for --dry-run songs whose audio is',
  '                             not cached yet.',
  '  --force                    Ignore both caches: re-download the audio and',
  '                             re-bill the provider call.',
  '  --json                     Print one machine-readable object per song on',
  '                             stdout (progress and the summary go to stderr).',
  '  --help                     Print this text.',
  '',
  'Exit codes: 0 every song was written/unchanged/skipped, 1 at least one song',
  'failed (including a repair patch the guardrails rejected), 2 could not start',
  '(bad usage, missing file, missing provider key).',
].join('\n');

class UsageError extends Error {}

function splitFlag(argument: string): [string, string | undefined] {
  const equals = argument.indexOf('=');
  return equals === -1
    ? [argument, undefined]
    : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function parseNumber(flag: string, value: string, minimum: number, allowEqual = false): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || (allowEqual ? parsed < minimum : parsed <= minimum)) {
    throw new UsageError(
      `${flag} needs a number ${allowEqual ? '>=' : '>'} ${minimum}, got '${value}'`,
    );
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    paths: [],
    all: false,
    provider: 'elevenlabs',
    stems: 'auto',
    density: 'every-line',
    padStart: 0,
    repair: false,
    repairMaxShift: DEFAULT_MAX_SHIFT_SEC,
    dryRun: false,
    force: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '') continue;
    if (!argument.startsWith('--')) {
      options.paths.push(argument);
      continue;
    }

    switch (argument) {
      case '--all':
        options.all = true;
        continue;
      case '--repair':
        options.repair = true;
        continue;
      case '--dry-run':
        options.dryRun = true;
        continue;
      case '--force':
        options.force = true;
        continue;
      case '--json':
        options.json = true;
        continue;
      case '--help':
      case '-h':
        options.help = true;
        continue;
      default:
        break;
    }

    const [flag, inlineValue] = splitFlag(argument);
    const value = inlineValue ?? argv[++index];
    if (value === undefined) throw new UsageError(`${flag} needs a value`);

    switch (flag) {
      case '--provider':
        if (!(PAID_ASR_PROVIDERS as string[]).includes(value)) {
          throw new UsageError(
            `--provider must be one of ${PAID_ASR_PROVIDERS.join(', ')}, got '${value}'`,
          );
        }
        options.provider = value as PaidAsrProvider;
        break;
      case '--stems':
        if (value !== 'auto' && value !== 'always' && value !== 'never') {
          throw new UsageError(`--stems must be auto, always or never, got '${value}'`);
        }
        options.stems = value;
        break;
      case '--density':
        if (value !== 'every-line' && value !== 'sparse') {
          throw new UsageError(`--density must be every-line or sparse, got '${value}'`);
        }
        options.density = value;
        break;
      case '--min-gap':
        options.minGap = parseNumber('--min-gap', value, 0, true);
        break;
      case '--pad-start':
        // Negative is meaningful (pull markers earlier for a late ASR onset).
        options.padStart = parseNumber('--pad-start', value, Number.NEGATIVE_INFINITY, true);
        break;
      case '--assume-duration':
        options.assumeDurationSec = parseNumber('--assume-duration', value, 0);
        break;
      case '--repair-max-shift':
        options.repairMaxShift = parseNumber('--repair-max-shift', value, 0);
        break;
      default:
        throw new UsageError(`unknown flag '${argument}'`);
    }
  }

  if (options.all && options.paths.length > 0) {
    throw new UsageError('pass either --all or explicit .ecb paths, not both');
  }
  // Silently ignoring the flag would let a caller believe a different bound was
  // in force while the default one rejected or accepted their patch.
  if (options.repairMaxShift !== DEFAULT_MAX_SHIFT_SEC && !options.repair) {
    throw new UsageError('--repair-max-shift only applies with --repair');
  }
  if (!options.all && options.paths.length === 0 && !options.help) {
    throw new UsageError('no songs given: pass one or more .ecb paths, or --all');
  }
  return options;
}

function displayPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative === '' || relative.startsWith('..') ? absolutePath : relative;
}

/** Every `songs/*.ecb`, sorted, so `--all` is reproducible. */
function allSongPaths(): string[] {
  const songsDir = path.join(REPO_ROOT, 'songs');
  return fs
    .readdirSync(songsDir)
    .filter((name) => name.endsWith('.ecb'))
    .sort()
    .map((name) => path.join(songsDir, name));
}

/**
 * Progress sink. Under `--json` stdout carries only the per-song objects, so
 * everything human-readable moves to stderr.
 */
function makeLogger(options: CliOptions): (message: string) => void {
  const sink = options.json ? console.error : console.log;
  return (message: string) => sink(`${LOG_PREFIX} ${message}`);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/** `M:SS` / `H:MM:SS`, for the human-readable duration in reports. */
function clockDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function repairCostUsd(lines: number): number {
  return (
    (lines * REPAIR_INPUT_TOKENS_PER_LINE * REPAIR_INPUT_USD_PER_MTOK) / 1e6 +
    (lines * REPAIR_OUTPUT_TOKENS_PER_LINE * REPAIR_OUTPUT_USD_PER_MTOK) / 1e6
  );
}

/**
 * Duration for `--dry-run`: the cached audio's ffprobe length when the audio is
 * already on disk (local, free), otherwise `--assume-duration`. A dry run never
 * downloads -- that is the difference between "estimate" and "start spending
 * bandwidth and wall-clock time on 20 songs".
 */
function estimateDuration(
  videoId: string,
  options: CliOptions,
): { durationSec: number; durationSource: 'cache' | 'assumed' } | null {
  const cachedAudio = audioCachePath(videoId, V1_AUDIO_SOURCE);
  const cached = fs.existsSync(cachedAudio) && fs.statSync(cachedAudio).size > 0;
  if (cached) return { durationSec: probeDurationSec(cachedAudio), durationSource: 'cache' };
  if (options.assumeDurationSec !== undefined) {
    return { durationSec: options.assumeDurationSec, durationSource: 'assumed' };
  }
  return null;
}

function costEstimate(
  durationSec: number,
  durationSource: 'cache' | 'assumed',
  pricePerHourUsd: number,
  repairLines: number,
): CostEstimate {
  const asrCostUsd = (durationSec / 3600) * pricePerHourUsd;
  const repairCost = repairCostUsd(repairLines);
  return {
    durationSec: round6(durationSec),
    durationSource,
    pricePerHourUsd,
    asrCostUsd: round6(asrCostUsd),
    repairLines,
    ...(repairLines > 0 ? { repairModel: repairModel() } : {}),
    repairCostUsd: round6(repairCost),
    totalUsd: round6(asrCostUsd + repairCost),
  };
}

/**
 * Mirror of audio.prepareAudio's two skip messages. Kept in step with that
 * function because `--dry-run` must report the skip without calling it: calling
 * prepareAudio would download the audio a dry run is supposed to avoid.
 */
function describeNoVideo(ecbRaw: string): string {
  const hasLine = ecbRaw.split('\n').some((line) => line.startsWith('%%youtube'));
  return hasLine
    ? 'skipped: %%youtube does not carry a usable video id'
    : 'skipped: no %%youtube line';
}

function dryRunSong(file: string, ecbRaw: string, options: CliOptions): SongResult {
  const display = displayPath(file);
  const info = asrProviderInfo(options.provider);
  const base: SongResult = { file: display, status: 'dry-run', provider: info.provider, model: info.model };

  const videoId = parseYoutubeId(ecbRaw);
  if (videoId === null) return { ...base, status: 'skipped', message: describeNoVideo(ecbRaw) };

  const normalized = normalizeLyrics(ecbRaw);
  const duration = estimateDuration(videoId, options);
  if (duration === null) {
    return {
      ...base,
      videoId,
      status: 'failed',
      message:
        `no cached audio to read a duration from for ${videoId}; ` +
        'pass --assume-duration S to estimate without downloading',
    };
  }

  return {
    ...base,
    videoId,
    durationSec: round6(duration.durationSec),
    estimate: costEstimate(
      duration.durationSec,
      duration.durationSource,
      info.pricePerHourUsd,
      // No --repair, no model: pricing the pass anyway would put spend in the
      // estimate that the run cannot make.
      options.repair ? normalized.lines.length : 0,
    ),
  };
}

/** One-line rendering of a repair patch's effect, for the run log. */
function describeChanges(changes: RepairChange[]): string {
  if (changes.length === 0) return 'changed nothing';
  const dropped = changes.filter((change) => change.kind === 'dropped').length;
  const moved = changes.length - dropped;
  const parts: string[] = [];
  if (moved > 0) parts.push(`moved ${moved}`);
  if (dropped > 0) parts.push(`dropped ${dropped}`);
  return `${parts.join(', ')} line(s)`;
}

/** Runs one song through the whole pipeline. Never throws: failures are results. */
async function processSong(
  file: string,
  options: CliOptions,
  log: (message: string) => void,
): Promise<SongResult> {
  const display = displayPath(file);
  const info = asrProviderInfo(options.provider);
  const base: SongResult = { file: display, status: 'failed', provider: info.provider, model: info.model };

  try {
    const ecbRaw = fs.readFileSync(file, 'utf8');

    if (options.dryRun) {
      const result = dryRunSong(file, ecbRaw, options);
      log(
        result.message !== undefined
          ? `${display}: ${result.message}`
          : `${display}: dry run, no calls made`,
      );
      return result;
    }

    const audio = prepareAudio(ecbRaw, { force: options.force, log });
    if (audio.status === 'skipped') {
      log(`${display}: ${audio.message}`);
      return { ...base, status: 'skipped', message: audio.message };
    }

    const normalized = normalizeLyrics(ecbRaw);
    if (normalized.videoId !== audio.videoId) {
      // Timestamps are only valid against the audio they were aligned to; two
      // parsers disagreeing about `%%youtube` means one of them is wrong.
      throw new Error(
        `normalize.ts read %%youtube ${normalized.videoId ?? '(none)'} but audio.ts used ` +
          `${audio.videoId}; refusing to time one video's lyrics against another's audio`,
      );
    }

    const key: AsrCacheKey = {
      videoId: audio.videoId,
      provider: info.provider,
      model: info.model,
      source: V1_AUDIO_SOURCE,
      lyricHash: normalized.lyricHash,
    };
    const client = createAsrClient(key, { force: options.force });
    const asr = await client.align({
      audioPath: audio.audioPath,
      durationSec: audio.durationSec,
      text: normalized.lines.map((line) => line.text).join('\n'),
      onProgress: log,
    });

    const aligned = alignLines(normalized, asr);
    const flagged = aligned.lines.filter((line) => line.flags.length > 0).length;

    // The repair pass only sees flagged lines and only returns a validated
    // patch, so whatever it does is still expressed as an AlignReport that the
    // emitter reads exactly as it reads the aligner's own output. A rejected
    // patch throws here, before anything is written.
    let report = aligned;
    let changes: RepairChange[] = [];
    let repairNotes: string | undefined;
    if (options.repair) {
      const proposer = options.repairProposer;
      if (proposer === undefined) {
        // main() always configures one for --repair; a missing proposer must
        // fail rather than quietly behave like a run without the flag.
        throw new Error('--repair has no repair proposer configured');
      }
      const repaired = await repairTimestamps(aligned, asr, {
        proposePatch: proposer,
        maxShiftSec: options.repairMaxShift,
        log,
      });
      report = repaired.report;
      changes = repaired.changes;
      repairNotes = repaired.notes === '' ? undefined : repaired.notes;
      log(
        repaired.consulted
          ? `${display}: repair ${describeChanges(changes)}` +
              (repairNotes === undefined ? '' : ` -- ${repairNotes}`)
          : `${display}: repair skipped, no flagged lines (no model call)`,
      );
    }

    const emitted = emitMarkers(ecbRaw, report, {
      minGap: options.minGap,
      density: options.density,
      padStart: options.padStart,
    });

    if (options.repair && changes.length > 0) {
      // The patch may only make the file better: what it produced is verified
      // offline before it is written, so a drop that left a reordered timeline
      // fails here instead of landing in a committed song.
      assertEmittable(emitted.text, display);
    }

    if (emitted.text === ecbRaw) {
      log(`${display}: already up to date (${emitted.inserted} markers would be written)`);
      return {
        ...base,
        status: 'unchanged',
        videoId: audio.videoId,
        durationSec: round6(audio.durationSec),
        inserted: emitted.inserted,
        markersSkipped: emitted.skipped,
        staleInlineMarkers: emitted.staleInlineMarkers,
        flagged,
        repaired: changes.length,
        repairNotes,
        unanchored: report.unanchored.length,
        report,
      };
    }

    fs.writeFileSync(file, emitted.text);
    log(
      `${display}: wrote ${emitted.inserted} markers ` +
        `(${report.unanchored.length} unanchored lines, ${flagged} flagged)`,
    );
    if (emitted.staleInlineMarkers > 0) {
      log(
        `${display}: removed ${emitted.staleInlineMarkers} hand-made inline marker(s); ` +
          `generated markers replace them (see docs/timestamp-pipeline.md)`,
      );
    }
    return {
      ...base,
      status: 'written',
      videoId: audio.videoId,
      durationSec: round6(audio.durationSec),
      inserted: emitted.inserted,
      markersSkipped: emitted.skipped,
      staleInlineMarkers: emitted.staleInlineMarkers,
      flagged,
      repaired: changes.length,
      repairNotes,
      unanchored: report.unanchored.length,
      report,
    };
  } catch (error) {
    const message = (error as Error).message;
    log(`${display}: failed: ${message}`);
    return { ...base, message };
  }
}

function renderDryRun(result: SongResult): string[] {
  const lines: string[] = [];
  const estimate = result.estimate;
  if (estimate === undefined) return lines;
  const from = estimate.durationSource === 'cache' ? 'cached audio' : '--assume-duration';
  lines.push(`${result.file}  (video: ${result.videoId}, provider: ${result.provider}/${result.model})`);
  lines.push(
    `  audio: ${clockDuration(estimate.durationSec)} (${estimate.durationSec.toFixed(1)}s) from ${from}`,
  );
  lines.push(
    `  asr: ${usd(estimate.asrCostUsd)} ` +
      `(${estimate.durationSec.toFixed(1)}s / 3600 x ${usd(estimate.pricePerHourUsd)}/audio-hour)`,
  );
  if (estimate.repairModel !== undefined) {
    lines.push(
      `  llm repair (${estimate.repairModel}): ${usd(estimate.repairCostUsd)} ` +
        `(${estimate.repairLines} lyric lines, priced as if every one were flagged, x ` +
        `${REPAIR_INPUT_TOKENS_PER_LINE} in / ${REPAIR_OUTPUT_TOKENS_PER_LINE} out tokens @ ` +
        `${usd(REPAIR_INPUT_USD_PER_MTOK)}/${usd(REPAIR_OUTPUT_USD_PER_MTOK)} per Mtok; ` +
        'only flagged lines are actually sent)',
    );
  }
  lines.push(`  estimate total: ${usd(estimate.totalUsd)}`);
  return lines;
}

function summarize(results: SongResult[], options: CliOptions): string {
  const counts = { written: 0, unchanged: 0, skipped: 0, failed: 0 };
  let flagged = 0;
  for (const result of results) {
    if (result.status === 'written') counts.written++;
    else if (result.status === 'unchanged') counts.unchanged++;
    else if (result.status === 'skipped') counts.skipped++;
    else if (result.status === 'failed') counts.failed++;
    flagged += result.flagged ?? 0;
  }
  if (!options.dryRun) {
    return (
      `Summary: written ${counts.written}, unchanged ${counts.unchanged}, ` +
      `skipped ${counts.skipped}, failed ${counts.failed}, flagged lines ${flagged}.`
    );
  }

  const priced = results.filter((result) => result.estimate !== undefined);
  const durationSec = priced.reduce((total, result) => total + (result.estimate?.durationSec ?? 0), 0);
  const asr = priced.reduce((total, result) => total + (result.estimate?.asrCostUsd ?? 0), 0);
  const repair = priced.reduce((total, result) => total + (result.estimate?.repairCostUsd ?? 0), 0);
  return (
    `Dry run: priced ${priced.length}, skipped ${counts.skipped}, ` +
    `could not price ${counts.failed}, flagged lines ${flagged}.\n` +
    `${clockDuration(durationSec)} (${durationSec.toFixed(1)}s) of audio: ` +
    `asr ${usd(asr)} + llm repair ${usd(repair)} = ${usd(asr + repair)} total. No paid calls made.`
  );
}

/**
 * Throws unless emitted marker text passes the offline verifier (check.ts).
 *
 * Applied to what a repair patch produced, before that text can reach a file: a
 * patch may only improve the timeline, so a drop or a move that leaves a
 * non-monotonic or out-of-range marker set fails the song instead of being
 * written. The checker needs no network, no key and no cached audio for the
 * orderings it hard-fails on.
 */
function assertEmittable(text: string, display: string): void {
  const verified = checkEcbText(text, display, {
    minSyllablesPerSec: DEFAULT_MIN_SYLLABLES_PER_SEC,
    maxSyllablesPerSec: DEFAULT_MAX_SYLLABLES_PER_SEC,
  });
  const errors = verified.findings.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `repaired markers would not verify (${errors.length} error(s), first: line ` +
        `${errors[0].line}: ${errors[0].message}); refusing to write`,
    );
  }
}

/**
 * `--dry-run --repair`'s preview: align from the cached audio/ASR alone, run the
 * repair path the real run would take, and print the diff it would write.
 *
 * It downloads nothing, calls no ASR provider and -- because a dry run must
 * spend nothing -- consults no repair model unless the caller injected one
 * (which is how the pass is exercised without a key). Without an injection it
 * reports what the real run would do and shows the aligner's own diff.
 */
async function previewRepair(
  file: string,
  ecbRaw: string,
  options: CliOptions,
  log: (message: string) => void,
): Promise<string[]> {
  const display = displayPath(file);
  try {
    return await previewRepairFor(display, ecbRaw, options, log);
  } catch (error) {
    // A preview must not take the run down: a dry run is a read-only look at
    // what --repair would do, so a rejected patch or an unparsable song is
    // reported here and the rest of the songs still get their estimates.
    return [`${display}: repair preview failed: ${(error as Error).message}`];
  }
}

async function previewRepairFor(
  display: string,
  ecbRaw: string,
  options: CliOptions,
  log: (message: string) => void,
): Promise<string[]> {
  const videoId = parseYoutubeId(ecbRaw);
  if (videoId === null) return [];

  const normalized = normalizeLyrics(ecbRaw);
  const info = asrProviderInfo(options.provider);
  const key: AsrCacheKey = {
    videoId,
    provider: info.provider,
    model: info.model,
    source: V1_AUDIO_SOURCE,
    lyricHash: normalized.lyricHash,
  };
  const asr = readAsrCache(key);
  if (asr === null) {
    return [
      `${display}: repair preview skipped, no cached ASR at ${displayPath(asrCachePath(key))}`,
    ];
  }

  const aligned = alignLines(normalized, asr);
  const flagged = aligned.lines.filter((line) => line.flags.length > 0).length;
  const out = [`${display}  (repair preview, cached audio/ASR, nothing written)`];

  let report = aligned;
  let changes: RepairChange[] = [];
  const proposer = options.repairProposer;
  if (flagged === 0) {
    out.push('  nothing flagged: a real --repair run would make no model call');
  } else if (proposer === undefined) {
    out.push(
      `  flagged lines: ${flagged}; a dry run consults no repair model, so the diff ` +
        'below is the aligner\'s own',
    );
  } else {
    const repaired = await repairTimestamps(aligned, asr, {
      proposePatch: proposer,
      maxShiftSec: options.repairMaxShift,
      log,
    });
    report = repaired.report;
    changes = repaired.changes;
    out.push(
      `  flagged lines: ${flagged}; repair ${describeChanges(changes)}` +
        (repaired.notes === '' ? '' : ` -- ${repaired.notes}`),
    );
  }

  const emitted = emitMarkers(ecbRaw, report, {
    minGap: options.minGap,
    density: options.density,
    padStart: options.padStart,
  });
  if (changes.length > 0) assertEmittable(emitted.text, display);

  const diff = renderMarkerDiff(ecbRaw, emitted.text, display);
  out.push(diff === '' ? '  no changes: the file already matches' : diff.trimEnd());
  return out;
}

async function main(argv: string[], hooks: CliHooks): Promise<number> {
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

  if (options.repair) {
    // A dry run must spend nothing, so it gets no live proposer: it previews from
    // cached artifacts instead. A real run builds the OpenAI one, and a caller
    // that injected one (tests) keeps it for both.
    options.repairProposer =
      hooks.proposePatch ?? (options.dryRun ? undefined : createOpenAiProposer());
  }

  // Checked before any song is read, so a missing key fails in the first second
  // rather than after 20 downloads (or, under --dry-run, not at all by surprise).
  const keyName = PROVIDER_API_KEY[options.provider];
  if (!hasApiKey(keyName)) {
    try {
      requireApiKey(keyName);
    } catch (error) {
      console.error((error as Error).message);
      return 2;
    }
  }
  if (options.repair && options.repairProposer !== undefined && !options.dryRun) {
    try {
      requireApiKey('OPENAI_API_KEY');
    } catch (error) {
      console.error((error as Error).message);
      return 2;
    }
  }

  const log = makeLogger(options);
  // --stems is validated and documented as unwired (see USAGE); saying so once
  // here keeps a caller from believing a demucs stem was used (ilg.12).
  if (options.stems !== 'never') {
    log(`--stems ${options.stems} accepted but not wired yet: timing the raw audio (ilg.12)`);
  }

  const targets = options.all ? allSongPaths() : options.paths.map((target) => path.resolve(target));
  const missing = targets.filter((target) => !fs.existsSync(target));
  if (missing.length > 0) {
    for (const target of missing) console.error(`no such file: ${target}`);
    return 2;
  }

  const results: SongResult[] = [];
  for (const target of targets) {
    results.push(await processSong(target, options, log));
  }

  const previewLines: string[] = [];
  if (options.dryRun && options.repair) {
    for (const target of targets) {
      previewLines.push(
        ...(await previewRepair(target, fs.readFileSync(target, 'utf8'), options, log)),
      );
    }
  }

  if (options.json) {
    for (const result of results) console.log(JSON.stringify(result));
    for (const line of previewLines) console.error(line);
    console.error(`${LOG_PREFIX} ${summarize(results, options)}`);
  } else {
    const dryRunLines = results.flatMap((result) => renderDryRun(result));
    if (dryRunLines.length > 0) {
      console.log('');
      console.log(dryRunLines.join('\n'));
      console.log('');
    }
    if (previewLines.length > 0) {
      console.log('');
      console.log(previewLines.join('\n'));
      console.log('');
    }
    console.log(summarize(results, options));
  }

  return results.some((result) => result.status === 'failed') ? 1 : 0;
}

/**
 * Test seam: the repair model call is the one non-deterministic, paid step, so a
 * caller may inject it. Nothing here reads a hook from argv.
 */
export interface CliHooks {
  proposePatch?: RepairProposer;
}

/** `npm run timestamps`'s entry point; returns the process exit code. */
export async function runTimestampsCli(argv: string[], hooks: CliHooks = {}): Promise<number> {
  return main(argv, hooks);
}

if (require.main === module) {
  runTimestampsCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`${LOG_PREFIX} ${(error as Error).message}`);
      process.exitCode = 1;
    },
  );
}
