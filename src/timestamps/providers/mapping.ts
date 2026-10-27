// Shared plumbing for the provider response mappers (tab-pinyinizer-ilg.3).
// Every adapter turns its own payload into the same AsrResult, so the identity
// fields, the createdAt stamp and the "which entries are usable tokens" rule live
// here once -- the adapters only name their text field and their payload shape.
//
// Nothing in this module touches the network or a file, so a mapper can be run
// against a recorded payload in __fixtures__ with no key and no spend.

import { syllableTokens } from '../pinyin';
import type { AsrProvider, AsrToken, AsrResult, AudioSource } from '../types';

/**
 * Identity of the AsrResult a mapper is producing. AlignRequest (ilg.15) carries
 * only the audio path and the lyric text, so the fields that label the cached
 * artifact travel alongside it.
 */
export interface AsrMappingContext {
  videoId: string;
  /** Model as billed/cached; part of the cache key, so it must match. */
  model: string;
  source: AudioSource;
  /** ffprobe duration of the audio handed to the provider, in seconds. */
  durationSec: number;
  /** Defaults to now; pin it to keep mapping byte-stable across runs. */
  createdAt?: string;
}

/** Reads a field off an unvalidated payload entry without assuming its shape. */
function field(entry: unknown, name: string): unknown {
  if (entry === null || typeof entry !== 'object') return undefined;
  return (entry as Record<string, unknown>)[name];
}

/** A payload string field; '' when it is missing or not a string. */
export function stringField(entry: unknown, name: string): string {
  const value = field(entry, name);
  return typeof value === 'string' ? value : '';
}

/** Provider payloads use null for unaligned entries; only finite numbers are usable. */
function finiteNumber(entry: unknown, name: string): number | undefined {
  const value = field(entry, name);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalizes one provider entry -- `{ <textField>: string, start, end, loss? }` --
 * or returns null when it carries nothing the aligner can use: no text, no
 * finite time pair, or no syllables. Punctuation, digits and whitespace fall into
 * that last case because pinyin.ts drops them from lyric syllables too, so such a
 * token could never match one.
 */
function asrToken(entry: unknown, textField: string): AsrToken | null {
  const text = stringField(entry, textField).trim();
  const start = finiteNumber(entry, 'start');
  const end = finiteNumber(entry, 'end');
  if (!text || start === undefined || end === undefined) return null;

  const pinyin = syllableTokens(text);
  if (!pinyin.length) return null;

  const loss = finiteNumber(entry, 'loss');
  return loss === undefined ? { text, pinyin, start, end } : { text, pinyin, start, end, loss };
}

/** Maps one provider's entry list, dropping entries no token came out of. */
export function mapTokens(entries: unknown[], textField: string): AsrToken[] {
  const tokens: AsrToken[] = [];
  for (const entry of entries) {
    const token = asrToken(entry, textField);
    if (token) tokens.push(token);
  }
  return tokens;
}

/** Assembles the normalized artifact every provider produces. */
export function buildAsrResult(
  provider: AsrProvider,
  ctx: AsrMappingContext,
  parts: { tokens: AsrToken[]; text?: string; raw: unknown },
): AsrResult {
  const result: AsrResult = {
    videoId: ctx.videoId,
    provider,
    model: ctx.model,
    source: ctx.source,
    durationSec: ctx.durationSec,
    tokens: parts.tokens,
    createdAt: ctx.createdAt ?? new Date().toISOString(),
    raw: parts.raw,
  };
  if (parts.text !== undefined) result.text = parts.text;
  return result;
}
