// Audio acquisition for the timestamp pipeline (tab-pinyinizer-ilg.1).
//
// Stage inputs are always the .ecb file itself: the embedded video's id lives in
// its `%%youtube` metadata line, and timestamps must stay relative to that
// video's 0:00. A separately sourced studio master is never substituted -- the
// two mixes differ in length and intro, which would silently break every seek.
//
// A song without `%%youtube` is not an error: callers get a typed `skipped`
// result and keep exit code 0 (see docs/timestamps-contract.md).

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { audioCachePath } from './paths';

/** `%%youtube <id>`; the id is the rest of the line's single token. */
const YOUTUBE_LINE_RE = /^%%youtube\s+(\S+)\s*$/;

/** YouTube ids are 11 chars of URL-safe base64-ish; allow the observed range. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

const LOG_PREFIX = '[timestamps:audio]';

/**
 * Plain, markup-free progress output. The pipeline runs from an agent or a pipe,
 * where colour/spinner formatting is just noise in the captured text.
 */
function log(message: string, sink?: (message: string) => void): void {
  (sink ?? console.log)(`${LOG_PREFIX} ${message}`);
}

export type AudioSkipReason = 'no-youtube-id' | 'invalid-youtube-id';

/** No audio to prepare; print `message` and continue with the next song. */
export interface AudioSkipped {
  status: 'skipped';
  reason: AudioSkipReason;
  /** One-line explanation, safe to print as-is. */
  message: string;
}

export interface AudioReady {
  status: 'ready';
  videoId: string;
  /** Cached mp3 of the embedded video; always the `raw` source, never demucs. */
  audioPath: string;
  /** ffprobe duration of `audioPath`, in seconds. */
  durationSec: number;
  /** True when the cached file already existed and `force` was not set. */
  fromCache: boolean;
}

export type AudioPreparation = AudioReady | AudioSkipped;

export interface AudioOptions {
  /** Re-download even when a cached mp3 exists. */
  force?: boolean;
  /** Progress sink; defaults to stdout. */
  log?: (message: string) => void;
}

/** The embedded video id, or null when the file has no usable `%%youtube` line. */
export function parseYoutubeId(ecbRaw: string): string | null {
  for (const line of ecbRaw.split('\n')) {
    const match = line.match(YOUTUBE_LINE_RE);
    if (!match) continue;
    return VIDEO_ID_RE.test(match[1]) ? match[1] : null;
  }
  return null;
}

/**
 * Duration of a local audio file via ffprobe, in seconds. Local-only: no network,
 * so it runs on every call rather than being cached alongside the audio.
 */
export function probeDurationSec(audioPath: string): number {
  const stdout = runFfprobe(audioPath);
  let duration: unknown;
  try {
    duration = (JSON.parse(stdout) as { format?: { duration?: unknown } }).format?.duration;
  } catch {
    throw new Error(`ffprobe returned unparseable JSON for ${audioPath}`);
  }
  const seconds = typeof duration === 'string' ? parseFloat(duration) : duration;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${audioPath}`);
  }
  return seconds;
}

/**
 * Ensures the embedded video's audio is cached and returns it with its duration.
 * Downloads only on a cache miss or with `force`; a song with no `%%youtube` line
 * returns `AudioSkipped` instead of throwing.
 */
export function prepareAudio(ecbRaw: string, options: AudioOptions = {}): AudioPreparation {
  const videoId = parseYoutubeId(ecbRaw);
  if (videoId === null) {
    const hasLine = ecbRaw.split('\n').some((line) => line.startsWith('%%youtube'));
    return hasLine
      ? {
          status: 'skipped',
          reason: 'invalid-youtube-id',
          message: 'skipped: %%youtube does not carry a usable video id',
        }
      : { status: 'skipped', reason: 'no-youtube-id', message: 'skipped: no %%youtube line' };
  }

  const audioPath = audioCachePath(videoId, 'raw');
  const fromCache = !options.force && isUsableAudioFile(audioPath);

  if (fromCache) {
    log(`using cached audio ${audioPath}`, options.log);
  } else {
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    log(`downloading audio for ${videoId} -> ${audioPath}`, options.log);
    downloadAudio(videoId, audioPath);
  }

  const durationSec = probeDurationSec(audioPath);
  return { status: 'ready', videoId, audioPath, durationSec, fromCache };
}

/** Zero bytes is not usable audio; treat it as a miss and re-fetch. */
function isUsableAudioFile(audioPath: string): boolean {
  return fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0;
}

function downloadAudio(videoId: string, audioPath: string): void {
  // Download to a sibling temp path and rename only on success: a killed or
  // failed download must never leave a truncated mp3 where the cache-hit check
  // would accept it as valid audio.
  const downloadPath = `${audioPath}.download.mp3`;
  fs.rmSync(downloadPath, { force: true });
  try {
    runCapture(
      'yt-dlp',
      [
        '-f',
        'bestaudio',
        '-x',
        '--audio-format',
        'mp3',
        '--no-playlist',
        '-o',
        downloadPath,
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      `yt-dlp download of ${videoId}`,
    );
    fs.renameSync(downloadPath, audioPath);
  } catch (error) {
    fs.rmSync(downloadPath, { force: true });
    throw error;
  }
}

function runFfprobe(audioPath: string): string {
  return runCapture(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath],
    `ffprobe probe of ${audioPath}`,
  );
}

function runCapture(command: string, args: string[], label: string): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new Error(`${command} is not installed or not on PATH (${label})`);
    }
    // yt-dlp's stderr is passed through untouched: a SABR/"page needs to be
    // reloaded" message is an environment problem the human must recognise as
    // such, not a lyrics problem to debug here.
    const stderr = err.stderr ?? '';
    throw new Error(`${label} failed:${stderr ? `\n${stderr}` : ` ${err.message}`}`);
  }
}
