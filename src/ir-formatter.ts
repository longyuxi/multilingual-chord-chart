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

/** Pad string to target width (exact, fractional): add ceil(target - contentWidth) spaces. */
function padToWidth(s: string, contentWidth: number, targetWidth: number): string {
  if (contentWidth >= targetWidth) return s;
  // Round the gap to avoid ceil(6.499999...) === 6 when we want 7 (e.g. 当天 → 7 spaces)
  const gap = Math.round((targetWidth - contentWidth) * 100) / 100;
  const n = Math.ceil(gap);
  return s + ' '.repeat(n);
}

function formatLine(segments: Segment[]): { chordLine: string; lyricsLine: string; pinyinLine: string | null } {
  if (segments.length === 0) {
    return { chordLine: '', lyricsLine: '', pinyinLine: null };
  }
  const segmentTargets = segments.map((seg) => {
    const c = displayWidth(seg.chord ?? '');
    const l = displayWidth(seg.lyrics ?? '');
    const p = displayWidth(seg.pinyin ?? '');
    let w = Math.max(c, l, p, 1);
    if (l === 0 && p === 0 && c > 0) w = Math.max(w, c + 1);
    return { c, l, p, w };
  });
  // Emit chord line first; track emitted width per segment (chord + spaces, rounded up).
  const emittedWidths: number[] = [];
  const chordParts = segments.map((seg, i) => {
    const { c, w } = segmentTargets[i];
    const n = Math.ceil(w - c);
    const emitted = c + n;
    emittedWidths.push(emitted);
    return (seg.chord ?? '') + ' '.repeat(n);
  });
  const chordLine = chordParts.join('');
  const lyricsLine = segments.map((seg, i) => {
    const l = segmentTargets[i].l;
    const e = emittedWidths[i];
    return padToWidth(seg.lyrics ?? '', l, e);
  }).join('');
  const hasPinyin = segments.some((seg) => (seg.pinyin ?? '').trim() !== '');
  const pinyinLine = hasPinyin
    ? segments.map((seg, i) => {
        const p = segmentTargets[i].p;
        const e = emittedWidths[i];
        return padToWidth(seg.pinyin ?? '', p, e);
      }).join('')
    : null;
  return { chordLine, lyricsLine, pinyinLine };
}

/**
 * Convert IR to chord tab string. Section headers [Verse 1], [Chorus], etc.;
 * for each lyric line: chord line, pinyin line (if any), lyrics line (Chinese); blank lines between sections.
 */
export function irToTabString(ir: Ir): string {
  const out: string[] = [];

  for (let p = 0; p < ir.paragraphs.length; p++) {
    const para = ir.paragraphs[p];

    // Section header (skip indeterminate and none)
    if (para.type !== 'none' && para.type !== 'indeterminate' && para.label) {
      out.push(`[${para.label}]`);
      out.push('');
    }

    for (const irLine of para.lines) {
      const segments = irLine.segments ?? [];
      if (segments.length === 0) {
        out.push('');
        continue;
      }

      const { chordLine, lyricsLine, pinyinLine } = formatLine(segments);
      out.push(chordLine.trimEnd());
      if (pinyinLine !== null) {
        out.push(pinyinLine.trimEnd());
      }
      out.push(lyricsLine.trimEnd());
    }

    if (p < ir.paragraphs.length - 1) {
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
