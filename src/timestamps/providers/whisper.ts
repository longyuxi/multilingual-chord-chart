// OpenAI whisper-1 word timestamps adapter -- the independent corroboration
// stream of the timestamp pipeline (tab-pinyinizer-ilg.3, contract in
// docs/timestamps-contract.md). Its text is deliberately unused: whisper is the
// second opinion on *when* a syllable happened, not on what was sung, so a
// whisper mishearing cannot rewrite a lyric.
//
// `mapWhisperResponse` is a pure function of an already-parsed payload, so it can
// be checked against __fixtures__ with no key and no spend; only
// `requestWhisperWordTimestamps` uploads anything.

import * as fs from 'fs';
import * as path from 'path';

import { requireApiKey } from '../env';
import type { AlignRequest, AsrResult } from '../types';
import { buildAsrResult, mapTokens } from './mapping';
import type { AsrMappingContext } from './mapping';

export const WHISPER_MODEL = 'whisper-1';
/** US$0.006 per audio minute. */
export const WHISPER_PRICE_PER_HOUR_USD = 0.36;

const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Transcription models this pipeline refuses on purpose. `gpt-4o-transcribe`
 * returns segment-level times with no word timestamps, which leaves nothing to
 * align syllables against; it is excluded rather than silently degraded.
 */
const MODELS_WITHOUT_WORD_TIMES: Record<string, string> = {
  'gpt-4o-transcribe': 'returns segment-level times only, with no word timestamps',
};

/** Rejects a model that cannot serve word times, before any upload. */
export function assertWordTimestampModel(model: string): string {
  const reason = MODELS_WITHOUT_WORD_TIMES[model];
  if (reason) {
    throw new Error(
      `${model} cannot be a timing source: it ${reason}. Use ${WHISPER_MODEL} with ` +
        `response_format=verbose_json and timestamp_granularities[]=word instead; the ` +
        `exclusion is deliberate (see docs/timestamps-contract.md).`,
    );
  }
  if (model !== WHISPER_MODEL) {
    throw new Error(
      `Unsupported transcription model ${model}: the timestamp pipeline only supports ${WHISPER_MODEL}.`,
    );
  }
  return model;
}

/**
 * Normalizes a `verbose_json` transcription into an AsrResult. Chinese words come
 * back as multi-character chunks, so `pinyin` is what turns them into syllables.
 */
export function mapWhisperResponse(payload: unknown, ctx: AsrMappingContext): AsrResult {
  const body = payload as { text?: unknown; words?: unknown } | null;
  if (!Array.isArray(body?.words)) {
    throw new Error(
      'whisper-1 response has no `words` array: request response_format=verbose_json ' +
        'with timestamp_granularities[]=word.',
    );
  }

  return buildAsrResult('whisper-1', ctx, {
    tokens: mapTokens(body.words, 'word'),
    text: typeof body.text === 'string' ? body.text : undefined,
    raw: payload,
  });
}

/** Uploads the audio and maps the word-timestamp response. */
export async function requestWhisperWordTimestamps(
  request: AlignRequest,
  ctx: AsrMappingContext,
): Promise<AsrResult> {
  assertWordTimestampModel(ctx.model);
  // Before the file is read, let alone uploaded: a missing key must not reach the
  // network (keys are provisioned by a human on tab-pinyinizer-ilg.14).
  const apiKey = requireApiKey('OPENAI_API_KEY');

  const audioName = path.basename(request.audioPath);
  request.onProgress?.(`uploading ${audioName} to whisper-1 for word timestamps`);

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(request.audioPath)]), audioName);
  form.append('model', ctx.model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const response = await fetch(TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `whisper-1 transcription failed: HTTP ${response.status} ${response.statusText} -- ${detail}`,
    );
  }

  return mapWhisperResponse(await response.json(), ctx);
}
