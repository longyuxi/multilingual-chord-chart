/**
 * In-house formatter: IR → chord tab text.
 * Uses Unicode East Asian Width (via wcwidth) so column counts match terminals and UAX #11.
 * See docs/fixed-width-rendering.md for why alignment can still be off in VS Code/Ultimate Guitar.
 */

import wcwidth = require('wcwidth');
import type { Ir, IrLine, IrParagraph, Segment } from './types/ir';

/**
 * Display width in terminal columns (Unicode UAX #11 / East Asian Width).
 * Wide/Full-width = 2, narrow = 1; combining = 0. Matches wcwidth(3) / POSIX.
 */
export function displayWidth(s: string): number {
  if (!s) return 0;
  const w = wcwidth(s);
  return w < 0 ? s.length : w;
}

/** Pad string to target display width with trailing spaces (Latin width only for padding). */
function padToWidth(s: string, width: number): string {
  const have = displayWidth(s);
  if (have >= width) return s;
  return s + ' '.repeat(width - have);
}

function formatLine(segments: Segment[]): { chordLine: string; lyricsLine: string; pinyinLine: string | null } {
  if (segments.length === 0) {
    return { chordLine: '', lyricsLine: '', pinyinLine: null };
  }
  const widths = segments.map((seg) => {
    const c = displayWidth(seg.chord ?? '');
    const l = displayWidth(seg.lyrics ?? '');
    const p = displayWidth(seg.pinyin ?? '');
    let w = Math.max(c, l, p, 1);
    // Chord-only lines: leave at least one space after each chord so they don't clump (e.g. "F G Am")
    if (l === 0 && p === 0 && c > 0) w = Math.max(w, c + 1);
    return w;
  });
  const chordLine = segments.map((seg, i) => padToWidth(seg.chord ?? '', widths[i])).join('');
  const lyricsLine = segments.map((seg, i) => padToWidth(seg.lyrics ?? '', widths[i])).join('');
  const hasPinyin = segments.some((seg) => (seg.pinyin ?? '').trim() !== '');
  const pinyinLine = hasPinyin
    ? segments.map((seg, i) => padToWidth(seg.pinyin ?? '', widths[i])).join('')
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
