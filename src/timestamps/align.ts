// Monotonic affine-gap alignment of lyric syllables to timed ASR tokens
// (tab-pinyinizer-ilg.4) -- the deterministic crux of the timestamp pipeline.
//
// Timing edits by an LLM are unfalsifiable and un-reproducible, so this stage is
// one pure function: the same NormalizedLyrics and the same asr.json always
// produce the same AlignReport, which is what makes a dry-run diff, the offline
// verifier (ilg.7) and the bounded repair pass (ilg.10) mean anything. Nothing
// here reads a file, an env var or an API key, and nothing draws on the clock or
// a random source.
//
// The DP is Needleman-Wunsch scored on toneless pinyin (normalize.ts and the
// provider mappers both derive syllables through pinyin.ts, so identical sounds
// are identical strings) with separate gap-open/gap-extend costs: one event for
// a skipped line, a burst of ad-libs or a spoken intro, instead of a run of
// expensive single gaps that would drag the alignment out of phase.

import type {
  AlignedLine,
  AlignReport,
  AsrResult,
  AsrToken,
  NormalizedLyrics,
} from './types';

export interface AlignOptions {
  /**
   * Confidence below which a line is flagged `low-confidence` and handed to the
   * repair pass. From tab-pinyinizer-ilg.4: "any line under ~60% matched".
   */
  minConfidence?: number;
  /**
   * Sung syllables per second above which a line looks impossible. Same default
   * as check.ts: the verifier judges the emitted markers by the same bound, so
   * the report and the check must not disagree.
   */
  maxSyllablesPerSec?: number;
  /** Below this rate a line gets `syllables-per-sec-low`. Same default as check.ts. */
  minSyllablesPerSec?: number;
}

export const DEFAULT_MIN_CONFIDENCE = 0.6;
export const DEFAULT_MIN_SYLLABLES_PER_SEC = 1.2;
export const DEFAULT_MAX_SYLLABLES_PER_SEC = 7;

/**
 * Toneless-pinyin similarity, in descending order of confidence: identical
 * syllables, syllables sharing an initial (`ta`/`tang`, the shape an ASR
 * near-miss takes), and anything else.
 */
type Similarity = 'exact' | 'initial' | 'none';

/** DP rewards/penalties. A substitution costs more than one unit of mismatch and
 * less than the two gap-opens it would take to delete and re-insert, so the DP
 * prefers pairing over skipping only when a real pair is there. */
const EXACT_SCORE = 2;
const INITIAL_SCORE = 1;
const MISMATCH_SCORE = -1;
/** A skipped run of k units costs OPEN + (k-1)*EXTEND. */
const GAP_OPEN_COST = 2;
const GAP_EXTEND_COST = 0.4;

/** Confidence a syllable contributes when it matched, before any provider loss. */
const EXACT_CONFIDENCE = 1;
const INITIAL_CONFIDENCE = 0.5;
/**
 * ElevenLabs `loss` is a positive alignment error: ~0.05 for a confidently
 * aligned character, ~0.4 for a token it could not place. Dividing by
 * 1 + WEIGHT*loss turns that into 0.83..0.38, which shades a line's confidence
 * without letting the provider's noise outweigh the text match itself.
 */
const LOSS_PENALTY_WEIGHT = 4;

/**
 * A stretch of transcribed audio this long that no lyric claimed is what a
 * repeated section (or a long ad-lib section) looks like after a monotonic
 * alignment: the DP matched the section once and stopped. Shorter unclaimed runs
 * are ordinary ad-libs/breaths between lines. Flagged, never solved
 * (docs/timestamps-contract.md, "Monotonic for v1").
 */
const REPEAT_SUSPECT_MIN_SEC = 8;

/** Keeps starts strictly increasing even when two lines fall inside one token. */
const MIN_START_ADVANCE_SEC = 0.001;

/** DP states: the pairing, then a gap on either side. */
const STATE_MATCH = 0;
const STATE_LYRIC_GAP = 1;
const STATE_AUDIO_GAP = 2;

const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

/**
 * One timed syllable of the ASR side. For ElevenLabs forced alignment -- the
 * primary provider, which returns one token per Chinese character -- a unit is
 * exactly a token. A whisper word like `只要` is one token with two syllables, so
 * it is split into one unit per syllable with the token's span divided evenly
 * between them: a token-sized cell could consume only one of those lyric
 * syllables and would silently halve the match count and confidence of every
 * whisper run.
 */
interface AsrUnit {
  pinyin: string;
  start: number;
  end: number;
  /** The enclosing token's ElevenLabs loss, carried onto each of its syllables. */
  loss: number | undefined;
}

/** The DP's pairing, in both directions, so neither side needs a second scan. */
interface Pairing {
  /** ASR unit matched to each lyric unit; -1 when nothing was sung for it. */
  asrForLyric: Int32Array;
  /** Lyric unit matched to each ASR unit; -1 when no lyric claimed it. */
  lyricForAsr: Int32Array;
}

interface Candidate {
  state: number;
  value: number;
}

/** Highest value, with ties broken by candidate order so the DP is reproducible. */
function pick(candidates: Candidate[]): Candidate {
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.value > best.value) best = candidate;
  }
  return best;
}

/** Milliseconds are far finer than the whole-second markers ilg.5 emits. */
function roundSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** Longest leading consonant cluster: `zh`/`ch`/`sh` whole, `y`/`w` as written. */
function syllableInitial(syllable: string): string {
  const match = /^[bcdfghjklmnpqrstvwxyz]+/.exec(syllable);
  return match === null ? '' : match[0];
}

/**
 * How one lyric syllable relates to one ASR syllable. An empty syllable (which
 * LyricSyllable allows for a source text that yielded none) never matches,
 * including another empty one: two missing values are not a correspondence.
 */
function similarity(lyric: string, asr: string): Similarity {
  if (lyric === '' || asr === '') return 'none';
  if (lyric === asr) return 'exact';
  const lyricInitial = syllableInitial(lyric);
  if (lyricInitial !== '' && lyricInitial === syllableInitial(asr)) return 'initial';
  return 'none';
}

function scoreOf(kind: Similarity): number {
  if (kind === 'exact') return EXACT_SCORE;
  return kind === 'initial' ? INITIAL_SCORE : MISMATCH_SCORE;
}

/** 0..1 contribution of one matched syllable to its line's confidence. */
function confidenceOf(kind: Similarity, loss: number | undefined): number {
  const base = kind === 'exact' ? EXACT_CONFIDENCE : kind === 'initial' ? INITIAL_CONFIDENCE : 0;
  if (base === 0 || loss === undefined) return base;
  return base / (1 + LOSS_PENALTY_WEIGHT * Math.max(0, loss));
}

/**
 * The lyric side, flattened into one reading-order syllable sequence -- which is
 * what makes the alignment monotonic: line boundaries are only recovered
 * afterwards, from the per-line syllable counts, so no line can match twice.
 */
function flattenSyllables(lyrics: NormalizedLyrics): string[] {
  const syllables: string[] = [];
  for (const line of lyrics.lines) {
    for (const syllable of line.syllables) syllables.push(syllable.pinyin);
  }
  return syllables;
}

function flattenTokens(tokens: AsrToken[]): AsrUnit[] {
  const units: AsrUnit[] = [];
  for (const token of tokens) {
    const count = token.pinyin.length;
    if (count === 0) continue; // nothing a lyric syllable could match
    const span = token.end - token.start;
    for (let index = 0; index < count; index++) {
      units.push({
        pinyin: token.pinyin[index],
        start: token.start + (span * index) / count,
        end: token.start + (span * (index + 1)) / count,
        loss: token.loss,
      });
    }
  }
  return units;
}

/**
 * Affine-gap Needleman-Wunsch over lyric syllables x ASR syllables.
 *
 * The lyric side is a single reading-order sequence, so it is monotonic by
 * construction: every lyric line is matched at most once and the melody cannot
 * jump backwards, which is exactly the v1 rule (a later repeat is a gap on the
 * audio side, never a second match). Backpointers are stored per state so the
 * traceback knows whether a gap was opened or extended.
 */
function alignUnits(lyric: string[], asr: AsrUnit[]): Pairing {
  const n = lyric.length;
  const m = asr.length;
  const width = m + 1;
  const cells = (n + 1) * width;

  const fromMatch = new Int8Array(cells);
  const fromLyricGap = new Int8Array(cells);
  const fromAudioGap = new Int8Array(cells);

  // Only two rows of scores are live at a time; the backpointer matrices are
  // kept whole because the traceback walks all of them.
  let prevMatch = new Float64Array(width);
  let prevLyricGap = new Float64Array(width);
  let prevAudioGap = new Float64Array(width);
  let curMatch = new Float64Array(width);
  let curLyricGap = new Float64Array(width);
  let curAudioGap = new Float64Array(width);

  prevMatch[0] = 0;
  prevLyricGap[0] = NEGATIVE_INFINITY;
  prevAudioGap[0] = NEGATIVE_INFINITY;
  for (let j = 1; j <= m; j++) {
    prevMatch[j] = NEGATIVE_INFINITY;
    prevLyricGap[j] = NEGATIVE_INFINITY;
    prevAudioGap[j] = -(GAP_OPEN_COST + (j - 1) * GAP_EXTEND_COST);
  }

  for (let i = 1; i <= n; i++) {
    const row = i * width;
    curMatch[0] = NEGATIVE_INFINITY;
    curLyricGap[0] = -(GAP_OPEN_COST + (i - 1) * GAP_EXTEND_COST);
    curAudioGap[0] = NEGATIVE_INFINITY;

    for (let j = 1; j <= m; j++) {
      const diagonal = pick([
        { state: STATE_MATCH, value: prevMatch[j - 1] },
        { state: STATE_LYRIC_GAP, value: prevLyricGap[j - 1] },
        { state: STATE_AUDIO_GAP, value: prevAudioGap[j - 1] },
      ]);
      curMatch[j] = diagonal.value + scoreOf(similarity(lyric[i - 1], asr[j - 1].pinyin));
      fromMatch[row + j] = diagonal.state;

      // This lyric syllable is not in the audio: an unsung line, an instrumental
      // bar, an omitted verse. A gap may open from either of the other states.
      const lyricGap = pick([
        { state: STATE_MATCH, value: prevMatch[j] - GAP_OPEN_COST },
        { state: STATE_AUDIO_GAP, value: prevAudioGap[j] - GAP_OPEN_COST },
        { state: STATE_LYRIC_GAP, value: prevLyricGap[j] - GAP_EXTEND_COST },
      ]);
      curLyricGap[j] = lyricGap.value;
      fromLyricGap[row + j] = lyricGap.state;

      // This ASR unit is not sung from the lyrics: a spoken intro, an ad-lib,
      // backing vocals, or a section repeat past what the file lists.
      const audioGap = pick([
        { state: STATE_MATCH, value: curMatch[j - 1] - GAP_OPEN_COST },
        { state: STATE_LYRIC_GAP, value: curLyricGap[j - 1] - GAP_OPEN_COST },
        { state: STATE_AUDIO_GAP, value: curAudioGap[j - 1] - GAP_EXTEND_COST },
      ]);
      curAudioGap[j] = audioGap.value;
      fromAudioGap[row + j] = audioGap.state;
    }

    [prevMatch, curMatch] = [curMatch, prevMatch];
    [prevLyricGap, curLyricGap] = [curLyricGap, prevLyricGap];
    [prevAudioGap, curAudioGap] = [curAudioGap, prevAudioGap];
  }

  const asrForLyric = new Int32Array(n).fill(-1);
  const lyricForAsr = new Int32Array(m).fill(-1);

  let state = pick([
    { state: STATE_MATCH, value: prevMatch[m] },
    { state: STATE_LYRIC_GAP, value: prevLyricGap[m] },
    { state: STATE_AUDIO_GAP, value: prevAudioGap[m] },
  ]).state;

  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i === 0) {
      state = STATE_AUDIO_GAP;
      j--;
      continue;
    }
    if (j === 0) {
      state = STATE_LYRIC_GAP;
      i--;
      continue;
    }
    if (state === STATE_MATCH) {
      asrForLyric[i - 1] = j - 1;
      lyricForAsr[j - 1] = i - 1;
      state = fromMatch[i * width + j];
      i--;
      j--;
    } else if (state === STATE_LYRIC_GAP) {
      state = fromLyricGap[i * width + j];
      i--;
    } else {
      state = fromAudioGap[i * width + j];
      j--;
    }
  }

  return { asrForLyric, lyricForAsr };
}

/**
 * Aligns normalized lyrics to a provider's timed tokens and reports one entry per
 * lyric line.
 *
 * A line is anchored at its first matched syllable's start and ends at its last
 * matched syllable's end -- for character-level tokens, the primary provider's
 * shape, that is literally its first and last matched token. Nothing is guessed
 * between lines: a line the DP could not place gets `start: null` plus the
 * `unanchored` flag rather than an interpolated time (tab-pinyinizer-ilg.4).
 * Starts are strictly increasing, which is what makes the emitted markers
 * (ilg.5) legal, and any line whose implied rate leaves the 1.2-7 syllables/sec
 * window, whose confidence falls short, or whose start lands past
 * `asr.durationSec` is flagged.
 *
 * Audio no lyric claimed comes back in `unmatchedAudio`, and a long unclaimed
 * stretch after the lyrics have begun also flags the last line before it as
 * `repeat-suspected`: the arrangement repeated a section the file lists once.
 */
export function alignLines(
  lyrics: NormalizedLyrics,
  asr: AsrResult,
  opts: AlignOptions = {},
): AlignReport {
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minSyllablesPerSec = opts.minSyllablesPerSec ?? DEFAULT_MIN_SYLLABLES_PER_SEC;
  const maxSyllablesPerSec = opts.maxSyllablesPerSec ?? DEFAULT_MAX_SYLLABLES_PER_SEC;

  const lyricSyllables = flattenSyllables(lyrics);
  const asrUnits = flattenTokens(asr.tokens);
  const pairing = alignUnits(lyricSyllables, asrUnits);

  const syllableCounts = lyrics.lines.map((line) => line.syllables.length);
  const lines: AlignedLine[] = lyrics.lines.map((line) => ({
    lineIndex: line.lineIndex,
    text: line.text,
    section: line.section,
    start: null,
    end: null,
    confidence: 0,
    flags: [],
  }));

  // Consumption of the line's syllables: confidence weights the matched ones by
  // similarity (and provider loss) against the line's whole syllable count, so a
  // line that only half matched cannot look confident.
  let unitIndex = 0;
  for (let position = 0; position < lines.length; position++) {
    const aligned = lines[position];
    let confidenceSum = 0;
    let firstMatched: AsrUnit | null = null;
    let lastMatched: AsrUnit | null = null;

    for (let syllable = 0; syllable < syllableCounts[position]; syllable++, unitIndex++) {
      const asrIndex = pairing.asrForLyric[unitIndex];
      if (asrIndex === -1) continue;
      const unit = asrUnits[asrIndex];
      confidenceSum += confidenceOf(similarity(lyricSyllables[unitIndex], unit.pinyin), unit.loss);
      if (firstMatched === null) firstMatched = unit;
      lastMatched = unit;
    }

    const syllables = syllableCounts[position];
    aligned.confidence = syllables === 0 ? 0 : roundSeconds(confidenceSum / syllables);
    if (firstMatched === null || lastMatched === null) {
      aligned.flags.push('unanchored');
      continue;
    }
    aligned.start = roundSeconds(firstMatched.start);
    aligned.end = roundSeconds(lastMatched.end);
  }

  // Strictly increasing starts are the invariant ilg.5 relies on. Two lines can
  // only collide inside one multi-syllable token (character-level tokens, the
  // primary provider's shape, are one syllable each and already ordered), so the
  // nudge is a millisecond, not a re-placement.
  let previousStart: number | null = null;
  for (const line of lines) {
    if (line.start === null) continue;
    if (previousStart !== null && line.start <= previousStart) {
      line.start = roundSeconds(previousStart + MIN_START_ADVANCE_SEC);
    }
    previousStart = line.start;
  }

  for (const line of lines) {
    if (line.start === null) continue;
    if (line.confidence < minConfidence) line.flags.push('low-confidence');
    if (line.start > asr.durationSec) line.flags.push('duration-exceeded');
  }

  // Interval plausibility, measured from a line's start to the next anchored
  // line's start -- the same span (and the same bounds) check.ts applies to a
  // marker and its successor.
  const anchoredPositions: number[] = [];
  lines.forEach((line, position) => {
    if (line.start !== null) anchoredPositions.push(position);
  });
  for (let index = 0; index < anchoredPositions.length; index++) {
    const position = anchoredPositions[index];
    const line = lines[position];
    if (line.start === null) continue;
    const nextPosition = index + 1 < anchoredPositions.length ? anchoredPositions[index + 1] : -1;
    const spanEnd = nextPosition === -1 ? asr.durationSec : (lines[nextPosition].start as number);
    const spanSeconds = spanEnd - line.start;
    if (spanSeconds <= 0 || syllableCounts[position] === 0) continue;
    const rate = syllableCounts[position] / spanSeconds;
    if (rate < minSyllablesPerSec) line.flags.push('syllables-per-sec-low');
    else if (rate > maxSyllablesPerSec) line.flags.push('syllables-per-sec-high');
  }

  const unmatchedAudio: AlignReport['unmatchedAudio'] = [];
  for (let index = 0; index < asrUnits.length; index++) {
    if (pairing.lyricForAsr[index] !== -1) continue;
    let last = index;
    while (last + 1 < asrUnits.length && pairing.lyricForAsr[last + 1] === -1) last++;
    unmatchedAudio.push({
      start: roundSeconds(asrUnits[index].start),
      end: roundSeconds(asrUnits[last].end),
    });
    index = last;
  }

  // A long unclaimed stretch that opens after the lyrics have started is a
  // repeated section; before the first anchor it is a spoken intro, which is
  // reported through `unmatchedAudio` alone.
  const firstAnchored = lines.find((line) => line.start !== null);
  const lyricsStart = firstAnchored?.start ?? null;
  for (const span of unmatchedAudio) {
    if (lyricsStart === null || span.start <= lyricsStart) continue;
    if (span.end - span.start < REPEAT_SUSPECT_MIN_SEC) continue;
    const before = lines.filter((line) => line.start !== null && line.start < span.start);
    const target = before[before.length - 1];
    if (target === undefined) continue;
    if (!target.flags.includes('repeat-suspected')) target.flags.push('repeat-suspected');
  }

  const unanchored = lines
    .filter((line) => line.start === null)
    .map((line) => line.lineIndex);

  return {
    videoId: asr.videoId,
    provider: asr.provider,
    model: asr.model,
    source: asr.source,
    durationSec: asr.durationSec,
    lines,
    unanchored,
    unmatchedAudio,
  };
}
