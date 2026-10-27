// Shared data contracts for the line-level timestamp pipeline
// (tab-pinyinizer-ilg). One module per stage owns the logic; every stage speaks
// in these types, so the provider, aligner, emitter, verifier and CLI stay
// independently replaceable.

/** Where timed tokens came from. `youtube-auto` is the free probe (ilg.11). */
export type AsrProvider = 'elevenlabs' | 'whisper-1' | 'youtube-auto';

/**
 * Which audio a stage ran on. `auto` only appears in a report, never in a cache
 * key: ilg.1 caches `raw` and `vocals` separately so an escalation retry after a
 * demucs pass (ilg.12) is free.
 */
export type StemsMode = 'auto' | 'always' | 'never';
export type AudioSource = 'raw' | 'vocals';

/** One timed unit of sung/spoken audio, normalized across providers. */
export interface AsrToken {
  /** Provider's own token text: usually one Chinese character, or one word. */
  text: string;
  /**
   * Toneless pinyin syllables for `text` (see pinyin.ts). Comparing toneless
   * pinyin instead of characters turns ASR homophone errors (的/得, ta/ta) into
   * matches rather than misses; the ECB pinyin convention is already
   * tone-mark-free, so nothing is lost.
   */
  pinyin: string[];
  /** Seconds from the start of the embedded video (never from a separate mp3). */
  start: number;
  end: number;
  /** Provider-confidenence/loss for this token when offered (ElevenLabs `loss`). */
  loss?: number;
}

/** Normalized provider output, cached as `asr.json` (ilg.3). */
export interface AsrResult {
  videoId: string;
  provider: AsrProvider;
  model: string;
  source: AudioSource;
  /** ffprobe duration of the audio handed to the provider, in seconds. */
  durationSec: number;
  /** Provider's full transcript, when it returns one. Never used for timing. */
  text?: string;
  tokens: AsrToken[];
  /** ISO-8601; provenance for the cache, never read by the aligner. */
  createdAt: string;
  /** Untouched provider payload. Debugging only. */
  raw?: unknown;
}

/** One syllable of a lyric line, in reading order. */
export interface LyricSyllable {
  /** Toneless pinyin; '' if the source text yielded none. */
  pinyin: string;
  /** The primary-language characters this syllable covers ('' for latin filler). */
  source: string;
}

/** One sung lyric line of the .ecb, ready to be matched against audio. */
export interface LyricLine {
  /**
   * 0-based line index in the .ecb source, so emission (ilg.5) can insert a
   * marker directly above the right line without re-parsing the file.
   */
  lineIndex: number;
  /** Primary-language lyric text, chords/markers/punctuation stripped. */
  text: string;
  /** All syllables across all segments of the line, in reading order. */
  syllables: LyricSyllable[];
  /** Enclosing `<Section>` label; '' when the line precedes any section. */
  section: string;
}

/** Output of lyric normalization (ilg.2). */
export interface NormalizedLyrics {
  videoId: string | null;
  /** The %%languages entry used for matching, e.g. 'chinese'. */
  language: string;
  lines: LyricLine[];
  /** sha256 of the matching-language text; part of the ASR cache key. */
  lyricHash: string;
}

/** Why a line's timestamp is questionable. Drives the repair pass (ilg.10). */
export type TimestampFlag =
  | 'low-confidence'
  | 'unanchored'
  | 'syllables-per-sec-low'
  | 'syllables-per-sec-high'
  | 'repeat-suspected'
  | 'duration-exceeded';

/** One lyric line's alignment outcome (ilg.4). */
export interface AlignedLine {
  lineIndex: number;
  text: string;
  section: string;
  /** Seconds; null when the DP treated the line as unsung. */
  start: number | null;
  end: number | null;
  /** 0..1 over the line's matched tokens; higher is better. */
  confidence: number;
  flags: TimestampFlag[];
}

/** Per-song alignment report; the CLI's --json payload and the repair input. */
export interface AlignReport {
  videoId: string;
  provider: AsrProvider;
  model: string;
  source: AudioSource;
  durationSec: number;
  lines: AlignedLine[];
  /** lyric lineIndexes left without an anchor. */
  unanchored: number[];
  /** Audio spans no lyric claimed: spoken intro, ad-libs, later repeats. */
  unmatchedAudio: { start: number; end: number }[];
}

/**
 * One entry of a bounded repair patch (ilg.10). The LLM may only assert a time
 * or drop a line; it never rewrites the file.
 */
export interface TimestampPatchEntry {
  /** Lyric lineIndex from the align report. */
  line: number;
  /** New start time in seconds; ignored when `drop` is true. */
  time?: number;
  drop?: boolean;
}

export interface TimestampPatch {
  entries: TimestampPatchEntry[];
  notes?: string;
}

/** What a provider stage is given; providers never read the .ecb themselves. */
export interface AlignRequest {
  /** Local path to the audio for the embedded video. */
  audioPath: string;
  /** ffprobe duration of that file, in seconds. */
  durationSec: number;
  /** Primary-language lyric text, one line per lyric line, in reading order. */
  text: string;
  /** Optional progress reporting for long uploads. */
  onProgress?: (message: string) => void;
}

/** A wired-up timing source (ilg.3, ilg.11). */
export interface AsrProviderClient {
  provider: AsrProvider;
  /** Model identifier as billed/cached, e.g. 'scribe_v1' or 'whisper-1'. */
  model: string;
  /** USD per audio hour, for the CLI's --dry-run estimate. */
  pricePerHourUsd: number;
  align(request: AlignRequest): Promise<AsrResult>;
}
