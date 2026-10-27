// Provider registry for the timestamp pipeline (tab-pinyinizer-ilg.3): the one
// place that knows which paid timing sources exist, what they cost, and how a
// (videoId, provider, model, source, lyricHash) cache entry maps onto a client.
//
// The stages above (align.ts, cli.ts) talk to AsrProviderClient only, so the
// adapters, their prices and their cache keys stay replaceable behind this file.

import type { AsrCacheKey } from '../paths';
import type { AlignRequest, AsrProvider, AsrProviderClient, AsrResult } from '../types';
import { resolveAsrResult } from './asr-cache';
import {
  ELEVENLABS_MODEL,
  ELEVENLABS_PRICE_PER_HOUR_USD,
  requestElevenLabsAlignment,
} from './elevenlabs';
import type { AsrMappingContext } from './mapping';
import { WHISPER_MODEL, WHISPER_PRICE_PER_HOUR_USD, requestWhisperWordTimestamps } from './whisper';

export { mapElevenLabsResponse, assertForcedAlignmentModel } from './elevenlabs';
export { mapWhisperResponse, assertWordTimestampModel } from './whisper';

/** Providers that bill per audio hour; `youtube-auto` (ilg.11) is the free probe. */
export type PaidAsrProvider = Exclude<AsrProvider, 'youtube-auto'>;

/** A provider as an orchestrator sees it: identity and billing rate, no network. */
export interface AsrProviderInfo {
  provider: PaidAsrProvider;
  model: string;
  pricePerHourUsd: number;
}

export interface AsrRunOptions {
  /** Re-bill even when the cache holds a result; the only bypass. */
  force?: boolean;
}

interface AsrProviderDefinition extends AsrProviderInfo {
  align(request: AlignRequest, ctx: AsrMappingContext): Promise<AsrResult>;
}

const PROVIDERS: Record<PaidAsrProvider, AsrProviderDefinition> = {
  elevenlabs: {
    provider: 'elevenlabs',
    model: ELEVENLABS_MODEL,
    pricePerHourUsd: ELEVENLABS_PRICE_PER_HOUR_USD,
    align: requestElevenLabsAlignment,
  },
  'whisper-1': {
    provider: 'whisper-1',
    model: WHISPER_MODEL,
    pricePerHourUsd: WHISPER_PRICE_PER_HOUR_USD,
    align: requestWhisperWordTimestamps,
  },
};

/** The paid providers a `--provider` flag may name, for validation and estimates. */
export const PAID_ASR_PROVIDERS = Object.keys(PROVIDERS) as PaidAsrProvider[];

/** Model and price for one provider; throws for `youtube-auto`, which has none. */
export function asrProviderInfo(provider: AsrProvider): AsrProviderInfo {
  const definition = definitionFor(provider);
  return {
    provider: definition.provider,
    model: definition.model,
    pricePerHourUsd: definition.pricePerHourUsd,
  };
}

/**
 * Binds one paid provider to one song's cache identity. The key names the
 * provider, model and stem, so it alone decides what is called and what is
 * billed; `align` is served from cache unless `force` is set.
 */
export function createAsrClient(key: AsrCacheKey, options: AsrRunOptions = {}): AsrProviderClient {
  const definition = definitionFor(key.provider);
  const force = options.force ?? false;

  return {
    provider: definition.provider,
    model: key.model,
    pricePerHourUsd: definition.pricePerHourUsd,
    align: (request: AlignRequest) =>
      resolveAsrResult(key, force, () =>
        definition.align(request, {
          videoId: key.videoId,
          model: key.model,
          source: key.source,
          durationSec: request.durationSec,
        }),
      ),
  };
}

function definitionFor(provider: AsrProvider): AsrProviderDefinition {
  if (provider === 'youtube-auto') {
    throw new Error(
      'youtube-auto is the free YouTube caption probe (tab-pinyinizer-ilg.11), not a ' +
        'paid provider, so it has no client here.',
    );
  }
  return PROVIDERS[provider];
}
