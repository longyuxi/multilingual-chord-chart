/**
 * In-house formatter: IR → chord tab text.
 * Uses display width so chords align with lyrics/pinyin (CJK = 2 columns, Latin = 1).
 */

import type { Ir, IrLine, IrParagraph, Segment } from './types/ir';

/** True if the character is CJK (full-width in typical fixed-width display). */
function isCjk(c: number): boolean {
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x3000 && c <= 0x303f)
  );
}

/**
 * Display width: CJK = 2, Latin = 1.
 * When a CJK character is followed by a space, count the pair as 2 (i.e. the space adds 0),
 * to better match how fixed-width systems often render "CJK + space".
 */
export function displayWidth(s: string): number {
  if (!s) return 0;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isCjk(c)) {
      w += 2;
      if (i + 1 < s.length && s[i + 1] === ' ') i++; // CJK + space = 2 total
    } else {
      w += 1;
    }
  }
  return w;
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
 * for each lyric line: chord line, lyrics line, pinyin line (if any); blank lines between sections.
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
      out.push(lyricsLine.trimEnd());
      if (pinyinLine !== null) {
        out.push(pinyinLine.trimEnd());
      }
    }

    if (p < ir.paragraphs.length - 1) {
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
