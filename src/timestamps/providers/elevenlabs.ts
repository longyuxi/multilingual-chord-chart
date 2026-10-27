// ElevenLabs forced alignment adapter -- the primary timing source of the
// timestamp pipeline (tab-pinyinizer-ilg.3, contract in
// docs/timestamps-contract.md). One Chinese character is one sung syllable, so
// the per-character times are already syllable-level, and the per-token `loss`
// gives the aligner a confidence to weigh.
//
// `mapElevenLabsResponse` is a pure function of an already-parsed payload, so it
// can be checked against __fixtures__ with no key and no spend; only
// `requestElevenLabsAlignment` uploads anything.

import * as fs from 'fs';
import * as path from 'path';

import { requireApiKey } from '../env';
import { containsCjk } from '../pinyin';
import type { AlignRequest, AsrResult } from '../types';
import { buildAsrResult, mapTokens, stringField } from './mapping';
import type { AsrMappingContext } from './mapping';

/**
 * Billing label for the cache key. /v1/forced-alignment takes no model
 * parameter and is priced at Scribe rates, so there is nothing else to record.
 */
export const ELEVENLABS_MODEL = 'scribe_v1';
export const ELEVENLABS_PRICE_PER_HOUR_USD = 0.22;

const FORCED_ALIGNMENT_URL = 'https://api.elevenlabs.io/v1/forced-alignment';

/** Rejects a model this endpoint cannot serve, before any upload. */
export function assertForcedAlignmentModel(model: string): string {
  if (model !== ELEVENLABS_MODEL) {
    throw new Error(
      `Unsupported ElevenLabs timing model ${model}: /v1/forced-alignment has no ` +
        `model parameter and is billed as ${ELEVENLABS_MODEL}.`,
    );
  }
  return model;
}

/**
 * Normalizes a forced-alignment payload into an AsrResult.
 *
 * Chinese uses the per-character stream. A latin song's character stream would
 * degrade into per-letter tokens that can never match a lyric word (pinyin.ts
 * keeps whole latin words), so those payloads use the per-word stream instead.
 */
export function mapElevenLabsResponse(payload: unknown, ctx: AsrMappingContext): AsrResult {
  const body = payload as { characters?: unknown; words?: unknown } | null;
  const characters = Array.isArray(body?.characters) ? body.characters : [];
  const words = Array.isArray(body?.words) ? body.words : [];

  const charactersAreSyllables = characters.some((entry) => containsCjk(stringField(entry, 'text')));
  const tokens = mapTokens(charactersAreSyllables ? characters : words, 'text');

  return buildAsrResult('elevenlabs', ctx, { tokens, raw: payload });
}

/** Uploads the audio plus the known lyrics and maps the response. */
export async function requestElevenLabsAlignment(
  request: AlignRequest,
  ctx: AsrMappingContext,
): Promise<AsrResult> {
  assertForcedAlignmentModel(ctx.model);
  // Before the file is read, let alone uploaded: a missing key must not reach the
  // network (keys are provisioned by a human on tab-pinyinizer-ilg.14).
  const apiKey = requireApiKey('ELEVENLABS_API_KEY');

  const audioName = path.basename(request.audioPath);
  request.onProgress?.(`uploading ${audioName} to ElevenLabs forced alignment`);

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(request.audioPath)]), audioName);
  // request.text is the primary-language lyrics in reading order, one line per
  // lyric line, already stripped of chords, markers, punctuation and section
  // labels by normalize.ts; the provider aligns against exactly that.
  form.append('text', request.text);

  const response = await fetch(FORCED_ALIGNMENT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `ElevenLabs forced alignment failed: HTTP ${response.status} ${response.statusText} -- ${detail}`,
    );
  }

  return mapElevenLabsResponse(await response.json(), ctx);
}
