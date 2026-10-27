// Cache layout for the timestamp pipeline (tab-pinyinizer-ilg.1). Kept separate
// from acquisition so the aligner, emitter and verifier can locate a cached
// result without pulling in yt-dlp or ffprobe handling.

import * as fs from 'fs';
import * as path from 'path';

import type { AsrProvider, AsrResult, AudioSource } from './types';

// Compiled output lives in dist/timestamps/paths.js, so two levels up is the
// repo root -- the same trick the legacy CLI scripts rely on.
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Gitignored. Everything here is reproducible from (videoId, provider, lyrics). */
export const TIMESTAMP_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'timestamps');
export const AUDIO_CACHE_DIR = path.join(TIMESTAMP_CACHE_DIR, 'audio');
export const ASR_CACHE_DIR = path.join(TIMESTAMP_CACHE_DIR, 'asr');

/**
 * Identity of a paid provider call. `lyricHash` is in the key because the same
 * audio aligned to edited lyrics is a genuinely different request -- but a
 * re-run with unchanged lyrics must never re-bill.
 */
export interface AsrCacheKey {
  videoId: string;
  provider: AsrProvider;
  model: string;
  source: AudioSource;
  lyricHash: string;
}

/** `raw` audio and the demucs `vocals` stem are cached independently. */
export function audioCachePath(videoId: string, source: AudioSource = 'raw'): string {
  const name = source === 'vocals' ? `${videoId}.vocals.mp3` : `${videoId}.mp3`;
  return path.join(AUDIO_CACHE_DIR, name);
}

export function asrCachePath(key: AsrCacheKey): string {
  const name = [key.provider, key.model, key.source, key.lyricHash.slice(0, 16)]
    .map((part) => part.replace(/[^A-Za-z0-9._-]+/g, '_'))
    .join('-');
  return path.join(ASR_CACHE_DIR, key.videoId, `${name}.json`);
}

/** Returns null on a miss; a corrupt cache file is also treated as a miss. */
export function readAsrCache(key: AsrCacheKey): AsrResult | null {
  const file = asrCachePath(key);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as AsrResult;
  } catch {
    return null;
  }
}

export function writeAsrCache(key: AsrCacheKey, result: AsrResult): string {
  const file = asrCachePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}
