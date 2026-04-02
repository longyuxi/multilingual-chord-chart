/**
 * Convert an IR to ECB (Extended Chord Bracket) format.
 * Section labels are ignored; each chord-lyric line is separated by a blank line.
 */

import type { Ir, Segment } from './types/ir';

export interface IrToEcbOptions {
  /**
   * Language labels in order: [lyrics, pinyin, translation].
   * Defaults to auto-detection based on which IR fields are populated.
   */
  languages?: string[];
}

function segmentHasContent(seg: Segment): boolean {
  return !!(seg.chord?.trim() || seg.lyrics?.trim() || seg.pinyin?.trim() || seg.translation?.trim());
}

/** True if the string looks like a chord symbol (e.g. Am, F#m7, Cmaj7). */
function looksLikeChord(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t) return false;
  return /^[A-G][#b]?(maj|min|m|M|sus|dim|aug|add|omit)?\d*(\/[A-G][#b]?)?$/.test(t);
}

/** True if the IR line has at least one segment with a real chord symbol. */
function lineHasChord(segs: Segment[]): boolean {
  return segs.some((s) => looksLikeChord(s.chord ?? ''));
}

function buildSegmentStr(
  seg: Segment,
  fields: Array<'lyrics' | 'pinyin' | 'translation'>
): string {
  const chord = seg.chord?.trim() ?? '';
  if (fields.length === 0) return `[${chord}]`;

  const values = fields.map((f) => (seg[f] ?? '').trimEnd());
  const hasAny = values.some((v) => v.trim() !== '');

  // Chord-only segment: no lyrics in any language slot
  if (!hasAny) return `[${chord}]`;

  return `[${chord}]${values.join('|')}`;
}

export function irToEcb(ir: Ir, options?: IrToEcbOptions): string {
  // Auto-detect which fields are populated across all segments
  let hasLyrics = false;
  let hasPinyin = false;
  let hasTranslation = false;
  for (const para of ir.paragraphs) {
    for (const line of para.lines) {
      for (const seg of line.segments) {
        if (seg.lyrics?.trim()) hasLyrics = true;
        if (seg.pinyin?.trim()) hasPinyin = true;
        if (seg.translation?.trim()) hasTranslation = true;
      }
    }
  }

  // Field order: lyrics (main/Chinese), pinyin, translation
  const fields: Array<'lyrics' | 'pinyin' | 'translation'> = [];
  const langNames: string[] = [];

  if (options?.languages) {
    const langs = options.languages;
    const mapping: Array<['lyrics' | 'pinyin' | 'translation', string]> = [
      ['lyrics', langs[0] ?? 'chinese'],
      ['pinyin', langs[1] ?? 'pinyin'],
      ['translation', langs[2] ?? 'translation'],
    ];
    for (const [field, lang] of mapping.slice(0, langs.length)) {
      fields.push(field);
      langNames.push(lang);
    }
  } else {
    if (hasLyrics) { fields.push('lyrics'); langNames.push('chinese'); }
    if (hasPinyin) { fields.push('pinyin'); langNames.push('pinyin'); }
    if (hasTranslation) { fields.push('translation'); langNames.push('translation'); }
  }

  const header: string[] = [];
  if (langNames.length > 0) {
    header.push(`%%languages ${langNames.join(', ')}`);
  }

  const ecbLines: string[] = [];
  for (const para of ir.paragraphs) {
    for (const irLine of para.lines) {
      const segs = irLine.segments.filter(segmentHasContent);
      if (segs.length === 0) continue;
      // Skip lines with no actual chord symbol (metadata, free-text, etc.)
      if (!lineHasChord(segs)) continue;
      ecbLines.push(segs.map((seg) => buildSegmentStr(seg, fields)).join(' '));
    }
  }

  const headerStr = header.join('\n');
  const bodyStr = ecbLines.join('\n\n');
  return headerStr ? headerStr + '\n\n' + bodyStr : bodyStr;
}
