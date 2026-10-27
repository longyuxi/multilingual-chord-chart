// Cache-first execution of a paid ASR call (tab-pinyinizer-ilg.3). The adapters
// own credentials and network; this module only decides whether a call is needed.
//
// Keyed by (videoId, provider, model, source, lyricHash) from paths.ts, so a
// re-run with unchanged lyrics is served from disk with no key and no spend, and
// `force` is the only way past it.

import { readAsrCache, writeAsrCache } from '../paths';
import type { AsrCacheKey } from '../paths';
import type { AsrResult } from '../types';

/**
 * Returns the cached result for `key`, or runs `produce` once and caches what it
 * returns. A forced run still overwrites the cached artifact, so after a provider
 * or model change the stale one cannot be served again.
 */
export async function resolveAsrResult(
  key: AsrCacheKey,
  force: boolean,
  produce: () => Promise<AsrResult>,
): Promise<AsrResult> {
  if (!force) {
    const cached = readAsrCache(key);
    if (cached) return cached;
  }

  const result = await produce();
  writeAsrCache(key, result);
  return result;
}
