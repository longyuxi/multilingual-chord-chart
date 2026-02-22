/**
 * In-house formatter: IR → chord tab text.
 * CJK characters count as 5/3 width units (3 CJK = 5 Latin), Latin as 1; we track emitted width per segment (with rounding).
 * See docs/fixed-width-rendering.md for context.
 */

import wcwidth = require('wcwidth');
import type { Ir, IrLine, IrParagraph, Segment } from './types/ir';

/** So that 3 CJK chars = 5 Latin chars (per Ultimate Guitar eyeballing). */
const CJK_WIDTH = 5 / 3;

/**
 * Display width with CJK = 5/3, Latin = 1 (fractional). Used for segment sizing and padding.
 * Combining/control = 0 (via wcwidth).
 */
export function displayWidth(s: string): number {
  if (!s) return 0;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    const wc = wcwidth(cp >= 0x10000 ? String.fromCodePoint(cp) : s[i]);
    if (wc <= 0) continue;
    w += wc === 2 ? CJK_WIDTH : 1;
    if (cp >= 0x10000) i++; // skip low surrogate
  }
  return w;
}

/**
 * Segment width = ceil(max of content widths). Gives integer column boundaries.
 * Then for each line we assign spaces so total spaces = round(totalWidth - totalContent),
 * and distribute per segment so the sum is exact (avoids cumulative rounding error).
 */
function formatLine(segments: Segment[]): {
  chordLine: string;
  lyricsLine: string;
  pinyinLine: string | null;
  translationLine: string | null;
} {
  if (segments.length === 0) {
    return { chordLine: '', lyricsLine: '', pinyinLine: null, translationLine: null };
  }
  const contentWidths = segments.map((seg) => ({
    c: displayWidth(seg.chord ?? ''),
    l: displayWidth(seg.lyrics ?? ''),
    p: displayWidth(seg.pinyin ?? ''),
    t: displayWidth(seg.translation ?? ''),
  }));
  const segmentWidths = contentWidths.map(({ c, l, p, t }) => {
    let w = Math.max(c, l, p, t, 1);
    if (l === 0 && p === 0 && t === 0 && c > 0) w = Math.max(w, c + 1);
    return Math.ceil(w);
  });
  const totalWidth = segmentWidths.reduce((a, b) => a + b, 0);

  function lineFor(getContent: (i: number) => string, getContentWidth: (i: number) => number): string {
    const contentW = segmentWidths.map((_, i) => getContentWidth(i));
    const totalContent = contentW.reduce((a, b) => a + b, 0);
    const totalSpacesNeeded = Math.round(Math.round((totalWidth - totalContent) * 100) / 100);
    const idealSpaces = segmentWidths.map((W, i) => W - contentW[i]);
    const spaceCounts: number[] = [];
    let sum = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      const n = Math.round(Math.round(idealSpaces[i] * 100) / 100);
      spaceCounts.push(n);
      sum += n;
    }
    spaceCounts.push(Math.max(0, totalSpacesNeeded - sum));
    return segments.map((seg, i) => getContent(i) + ' '.repeat(spaceCounts[i])).join('');
  }

  const chordLine = lineFor((i) => segments[i].chord ?? '', (i) => contentWidths[i].c);
  const lyricsLine = lineFor((i) => segments[i].lyrics ?? '', (i) => contentWidths[i].l);
  const hasPinyin = segments.some((seg) => (seg.pinyin ?? '').trim() !== '');
  const pinyinLine = hasPinyin
    ? lineFor((i) => segments[i].pinyin ?? '', (i) => contentWidths[i].p)
    : null;
  const hasTranslation = segments.some((seg) => (seg.translation ?? '').trim() !== '');
  const translationLine = hasTranslation
    ? lineFor((i) => segments[i].translation ?? '', (i) => contentWidths[i].t)
    : null;
  return { chordLine, lyricsLine, pinyinLine, translationLine };
}

/**
 * Convert IR to chord tab string. Section headers [Verse 1], [Chorus], etc.;
 * for each lyric line: chord line, pinyin line (if any), lyrics line (Chinese), translation line (if any non-empty); blank lines between sections.
 * Translation line is omitted when every segment's translation is empty.
 */
export function irToTabString(ir: Ir): string {
  const out: string[] = [];

  for (const para of ir.paragraphs) {
    const labelStr = para.label != null ? String(para.label).trim() : '';

    // Blank line before every section title (but not at the very start of the file)
    if (labelStr !== '' && out.length > 0) {
      out.push('');
    }
    if (labelStr !== '') {
      out.push(`[${labelStr}]`);
    }

    for (const irLine of para.lines) {
      const segments = irLine.segments ?? [];
      if (segments.length === 0) continue;

      const { chordLine, lyricsLine, pinyinLine, translationLine } = formatLine(segments);
      if (chordLine.trimEnd()) out.push(chordLine.trimEnd());
      if (pinyinLine !== null) out.push(pinyinLine.trimEnd());
      if (lyricsLine.trimEnd()) out.push(lyricsLine.trimEnd());
      if (translationLine !== null && translationLine.trimEnd()) out.push(translationLine.trimEnd());
    }
  }

  return out.join('\n') + '\n';
}
