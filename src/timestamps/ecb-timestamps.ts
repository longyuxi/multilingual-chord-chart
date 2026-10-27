// Marker emission (tab-pinyinizer-ilg.5): turn an AlignReport into standalone
// `@M:SS` lines in the .ecb, and nothing else. A marker on its own line leaves
// every lyric line's chords and language columns byte-identical to what
// normalize.ts (ilg.2) read, so the pinyin and syllable-matched translation
// tooling downstream is unaffected.
//
// Re-running is idempotent: every marker in the file is treated as this
// module's own previous output, stripped, and rebuilt from the report, so
// emitting twice over the same file and report yields a byte-identical file
// (docs/timestamps-contract.md, "Emission is idempotent").
//
// That includes *inline* markers, not just standalone ones. A hand-made inline
// marker (condensed_blue_whale.ecb's `@1:52`) is a fixed point in the timeline
// that a regenerated set of standalone markers cannot respect: the file ends up
// with two marker sources that disagree about the same song, and check.ts
// rejects the result as non-monotonic. One owner per file is the only
// consistent rule, so a file the pipeline writes keeps standalone markers only.
// Recover a hand-authored inline marker from git history if a run destroys one.

import { findStandaloneMarkers, formatMarker, stripInlineMarkers } from './ecb-markers';
import type { AlignReport } from './types';

export interface EmitOptions {
  /**
   * Minimum seconds between two emitted markers. 0 (the default) marks every
   * anchored lyric line; a larger value thins the markers out.
   */
  minGap?: number;
  /**
   * Preset for `minGap` when the caller passes no explicit value: `sparse` is
   * the hand-made style of songs/condensed_blue_whale.ecb (one marker every
   * ~12 s, i.e. once or twice per section rather than once per line).
   */
  density?: 'every-line' | 'sparse';
  /**
   * Seconds added to every marker time before whole-second flooring, for a
   * known lead-in or ASR onset bias. Negative pulls markers earlier; the result
   * is clamped at 0:00. Default 0.
   */
  padStart?: number;
}

export interface EmitResult {
  /** The emitted .ecb text; identical to the input when nothing was marked. */
  text: string;
  /** Marker lines written. */
  inserted: number;
  /** Report lines that did not get a marker (see the reasons in emitMarkers). */
  skipped: number;
  /** Hand-authored inline markers removed so the emitted set stays single-owner. */
  staleInlineMarkers: number;
}

/** Gap used by `density: 'sparse'`, matching condensed_blue_whale.ecb. */
const SPARSE_MIN_GAP_SEC = 12;

/** Unchanged lines shown around each diff hunk. */
const DIFF_CONTEXT = 3;

/**
 * Inserts one standalone `@M:SS` marker line directly above every anchored
 * lyric line in `report`, after removing every marker already in the file --
 * standalone markers from a previous run and inline markers alike (see the
 * single-owner note at the top of this file).
 *
 * A report line is skipped when its `start` is null (unsung), when its
 * `lineIndex` does not point at a lyric line of `rawEcb`, when `minGap` thins
 * it out, or when it floors to the same whole second as the marker before it
 * (two markers on one second say nothing extra, and the markers have to stay
 * strictly increasing). A report that moves backwards in time throws instead of
 * writing a file whose markers decrease.
 */
export function emitMarkers(rawEcb: string, report: AlignReport, opts: EmitOptions = {}): EmitResult {
  const minGap = opts.minGap ?? (opts.density === 'sparse' ? SPARSE_MIN_GAP_SEC : 0);
  const padStart = opts.padStart ?? 0;

  // Every marker is treated as a previous run's output, so it is removed
  // before rebuilding: standalone marker lines disappear entirely, inline ones
  // are cut out of their lyric line (which keeps its line number, so the
  // report's lineIndex mapping below still holds).
  const markerLineIndexes = new Set(findStandaloneMarkers(rawEcb).map((marker) => marker.lineIndex));
  const lines: string[] = [];
  const strippedIndexBySourceIndex = new Map<number, number>();
  let staleInlineMarkers = 0;
  rawEcb.split('\n').forEach((line, sourceIndex) => {
    if (markerLineIndexes.has(sourceIndex)) return;
    strippedIndexBySourceIndex.set(sourceIndex, lines.length);
    const withoutInline = stripInlineMarkers(line);
    // `@1:52` -> `` leaves the segment's language column untouched; collapse
    // only the doubled space that removal can create in the chord/lyric text.
    lines.push(withoutInline === line ? line : withoutInline.replace(/(\S) {2,}(?=\S)/g, '$1 '));
    if (withoutInline !== line) staleInlineMarkers += 1;
  });

  const markerByStrippedIndex = new Map<number, string>();
  let lastMarkerSec: number | null = null;
  let skipped = 0;

  for (const line of [...report.lines].sort((a, b) => a.lineIndex - b.lineIndex)) {
    const at = strippedIndexBySourceIndex.get(line.lineIndex);
    if (line.start === null || at === undefined || !isLyricLine(lines[at])) {
      skipped++;
      continue;
    }
    const seconds = Math.max(0, Math.floor(line.start + padStart));
    if (lastMarkerSec !== null) {
      if (seconds < lastMarkerSec) {
        throw new Error(
          `ecb-timestamps: alignment report is not monotonic -- line ${line.lineIndex + 1} starts at ` +
            `${line.start}s, before the ${lastMarkerSec}s marker already emitted for an earlier line`,
        );
      }
      if (seconds === lastMarkerSec || seconds - lastMarkerSec < minGap) {
        skipped++;
        continue;
      }
    }
    markerByStrippedIndex.set(at, formatMarker(seconds));
    lastMarkerSec = seconds;
  }

  // Nothing anchored: leave the file exactly as it is rather than dropping the
  // markers it already has.
  if (markerByStrippedIndex.size === 0) {
    return { text: rawEcb, inserted: 0, skipped, staleInlineMarkers };
  }

  const out: string[] = [];
  lines.forEach((line, index) => {
    const marker = markerByStrippedIndex.get(index);
    // Above the lyric line itself, never above a preceding blank line: a blank
    // line between marker and lyric would abandon the timestamp
    // (prompts/general_spec.md), and this way the file's own blank lines stay
    // where they are.
    if (marker !== undefined) out.push(marker);
    out.push(line);
  });

  return { text: out.join('\n'), inserted: markerByStrippedIndex.size, skipped, staleInlineMarkers };
}

/**
 * Renders the emit result as a unified diff for `--dry-run`; '' when the file
 * would not change. Hand-rolled because a song is a few hundred lines and the
 * pipeline should not pull in a diff dependency for it.
 */
export function renderMarkerDiff(before: string, after: string, filePath = 'song.ecb'): string {
  if (before === after) return '';

  const numbered = diffLines(splitLines(before), splitLines(after));
  const header = `--- ${filePath}\n+++ ${filePath}`;

  const groups: Array<[number, number]> = [];
  numbered.forEach((entry, index) => {
    if (entry.kind === ' ') return;
    const start = Math.max(0, index - DIFF_CONTEXT);
    const end = Math.min(numbered.length, index + DIFF_CONTEXT + 1);
    const last = groups[groups.length - 1];
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else groups.push([start, end]);
  });

  const out = [header];
  for (const [start, end] of groups) {
    const slice = numbered.slice(start, end);
    const oldCount = slice.filter((entry) => entry.kind !== '+').length;
    const newCount = slice.filter((entry) => entry.kind !== '-').length;
    const oldStart = oldCount === 0 ? numbered[start].oldLine - 1 : numbered[start].oldLine;
    const newStart = newCount === 0 ? numbered[start].newLine - 1 : numbered[start].newLine;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const entry of slice) out.push(`${entry.kind}${entry.text}`);
  }
  return `${out.join('\n')}\n`;
}

interface DiffEntry {
  kind: ' ' | '-' | '+';
  text: string;
  /** 1-based line number in `before` that this entry sits at. */
  oldLine: number;
  /** 1-based line number in `after` that this entry sits at. */
  newLine: number;
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Longest-common-subsequence line diff, with per-side line numbers attached. */
function diffLines(before: string[], after: string[]): DiffEntry[] {
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const entries: DiffEntry[] = [];
  let oldLine = 1;
  let newLine = 1;
  const push = (kind: DiffEntry['kind'], text: string) => {
    entries.push({ kind, text, oldLine, newLine });
    if (kind !== '+') oldLine++;
    if (kind !== '-') newLine++;
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      push(' ', before[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('-', before[i++]);
    else push('+', after[j++]);
  }
  while (i < n) push('-', before[i++]);
  while (j < m) push('+', after[j++]);
  return entries;
}

/**
 * True for lines the viewer would read as lyrics (any line carrying a `[`
 * segment), and false for blank lines, comments/config, free text and section
 * headers -- a marker above any of those would annotate nothing.
 */
function isLyricLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('%') || trimmed.startsWith('>')) return false;
  if (/^<.+>$/.test(trimmed)) return false;
  return line.includes('[');
}
