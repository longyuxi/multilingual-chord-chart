/**
 * Convert a ChordSheetJS Song directly to ECB (Extended Chord Bracket) format,
 * without materializing the IR (Ir/IrParagraph/IrLine/Segment) tree from src/ir.ts.
 *
 * This is a single-pass port of songToIr() (src/ir.ts, chord/lyric/pinyin alignment) combined
 * with irToEcb() (src/ir-to-ecb.ts, ECB line rendering). The intermediate paragraph/line/segment
 * shapes below are local to this module (EcbSegment/EcbLine/EcbParagraph) — not the Ir-typed tree.
 */

import ChordSheetJS from 'chordsheetjs';
import wcwidth = require('wcwidth');

const CJK_COL_WIDTH = 5 / 3;

/** Display width of a single character (CJK = 5/3, Latin = 1, combining = 0). */
function charColWidth(ch: string): number {
  const wc = wcwidth(ch);
  return wc <= 0 ? 0 : wc === 2 ? CJK_COL_WIDTH : 1;
}

/** Display width of a string using CJK = 5/3 weighting. */
function strColWidth(s: string): number {
  if (!s) return 0;
  let w = 0;
  for (const ch of s) w += charColWidth(ch);
  return w;
}

/** True if the string contains any CJK (double-width) character. */
function hasCJK(s: string): boolean {
  for (const ch of s) if (wcwidth(ch) === 2) return true;
  return false;
}

/**
 * Split `text` across `segWidths.length` buckets using cumulative column-width boundaries.
 * Characters are assigned to the current bucket until the running column position reaches
 * the next boundary, then spill into the next bucket.
 */
function splitByCumulativeWidths(text: string, segWidths: number[]): string[] {
  if (segWidths.length === 0) return [];
  if (segWidths.length === 1) return [text];
  const result: string[] = Array(segWidths.length).fill('');
  // Compute cumulative boundaries (one per internal boundary)
  const boundaries: number[] = [];
  let cum = 0;
  for (let i = 0; i < segWidths.length - 1; i++) {
    cum += segWidths[i];
    boundaries.push(cum);
  }
  let col = 0;
  let si = 0;
  for (const ch of text) {
    // Compare in 1/3-unit integers to avoid floating-point drift from repeated 5/3 additions.
    // All valid column positions are multiples of 1/3 (CJK = 5/3, Latin = 3/3), so
    // Math.round(col * 3) is always exact, matching the ceil-based integer segment widths.
    while (si < boundaries.length && Math.round(col * 3) >= boundaries[si] * 3) si++;
    result[si] += ch;
    col += charColWidth(ch);
  }
  return result;
}

/** Heuristic: segment chord looks like a chord symbol (e.g. Am, F#m7), not metadata (Capo=4, title text). */
function looksLikeChordSymbol(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t) return false;
  return /^[A-Ga-g][#b]?\d*[mM]?(maj|min|sus|dim|aug|maj7|min7|add|omit)*\d*(\/[A-Ga-g][#b]?)?$/i.test(t) || /^[A-G][#b]?(maj|min|m|M|sus|dim|aug)?\d*$/i.test(t);
}

/** True if the string looks like a chord symbol (e.g. Am, F#m7, Cmaj7). Stricter/uppercase-only variant used at ECB emission time. */
function looksLikeChord(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t) return false;
  return /^[A-G][#b]?(maj|min|m|M|sus|dim|aug|add|omit)?\d*(\/[A-G][#b]?)?$/.test(t);
}

/** Local (non-IR) segment shape used only within this module. */
interface EcbSegment {
  chord: string;
  lyrics: string;
  pinyin: string;
  translation?: string;
}

/** Local (non-IR) line shape used only within this module. */
interface EcbLine {
  segments: EcbSegment[];
}

/** Local (non-IR) paragraph shape used only within this module. */
interface EcbParagraph {
  label?: string;
  lines: EcbLine[];
}

export interface SongToEcbOptions {
  /** If true, put parsed line text into pinyin and leave lyrics empty. Default: false (text -> lyrics). */
  textAsPinyin?: boolean;
  /**
   * If true, parse both pinyin and Chinese lyrics simultaneously.
   * ChordSheetJS pairs chord+pinyin; the following CJK-only line is distributed as lyrics
   * across the preceding line's segments using column-width splitting.
   */
  bothPinyinAndLyrics?: boolean;
  /**
   * Raw tab file content. When set, section titles are extracted from lines like [Verse 1], [Chorus],
   * and assigned to paragraphs in order (so round-trip preserves [Verse 1] etc.).
   */
  rawTabContent?: string;
  /**
   * Language labels in order: [lyrics, pinyin, translation].
   * Defaults to auto-detection based on which fields are populated.
   */
  languages?: string[];
}

/** Segment is empty if chord, lyrics, pinyin (and translation) are all empty or whitespace. */
function isSegmentEmpty(s: EcbSegment): boolean {
  const t = (v: string | undefined) => (v ?? '').trim();
  return !t(s.chord) && !t(s.lyrics) && !t(s.pinyin) && !t(s.translation);
}

/** Remove empty segments from each line, then remove lines that have no segments left. Done before merge. */
function stripEmptySegmentsAndLines(paragraphs: EcbParagraph[]): EcbParagraph[] {
  return paragraphs.map((para) => {
    const lines = (para.lines ?? [])
      .map((line) => ({
        ...line,
        segments: (line.segments ?? []).filter((s) => !isSegmentEmpty(s)),
      }))
      .filter((line) => line.segments.length > 0);
    return { ...para, lines };
  });
}

/** True if paragraph has no label and no meaningful content (no lines or only empty lines). */
function isEmptyUnlabeled(para: EcbParagraph): boolean {
  if (para.label !== undefined && para.label !== '') return false;
  if (!para.lines?.length) return true;
  return para.lines.every(
    (l) => !l.segments?.length || l.segments.every((s) => !s.chord && !s.lyrics && !s.pinyin)
  );
}

/**
 * Greedily merge neighboring paragraphs that have the same section label
 * (e.g. multiple "Verse" blocks become one "Verse" with all lines).
 * First collapses empty unlabeled paragraphs into the previous paragraph so that
 * same-label sections become adjacent (e.g. Verse, blank, Verse -> one Verse).
 */
function mergeConsecutiveSectionsWithSameLabel(paragraphs: EcbParagraph[]): EcbParagraph[] {
  if (paragraphs.length <= 1) return paragraphs;
  // Collapse empty unlabeled paragraphs into the previous paragraph
  const collapsed: EcbParagraph[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (isEmptyUnlabeled(p) && collapsed.length > 0) {
      collapsed[collapsed.length - 1] = {
        ...collapsed[collapsed.length - 1],
        lines: [...collapsed[collapsed.length - 1].lines, ...(p.lines ?? [])],
      };
    } else {
      collapsed.push({ ...p, lines: [...(p.lines ?? [])] });
    }
  }
  // Merge consecutive paragraphs with the same label
  if (collapsed.length <= 1) return collapsed;
  const result: EcbParagraph[] = [];
  let current: EcbParagraph = { ...collapsed[0], lines: [...collapsed[0].lines] };
  for (let i = 1; i < collapsed.length; i++) {
    const p = collapsed[i];
    const sameLabel =
      current.label !== undefined && p.label !== undefined && current.label === p.label;
    if (sameLabel) {
      current = { ...current, lines: [...current.lines, ...p.lines] };
    } else {
      result.push(current);
      current = { ...p, lines: [...p.lines] };
    }
  }
  result.push(current);
  return result;
}

/**
 * Align a ChordSheetJS Song's chords/lyrics/pinyin into local paragraph/line/segment structures.
 * Direct port of songToIr() (src/ir.ts), minus the unused `meta` field (irToEcb never read IR meta).
 */
function buildParagraphs(
  song: { bodyParagraphs?: Array<{ type?: string; lines?: Array<{ items?: Array<{ chords?: string; lyrics?: string }> }> }> },
  options?: SongToEcbOptions
): EcbParagraph[] {
  const bothPinyinAndLyrics = options?.bothPinyinAndLyrics ?? false;
  // In --both mode text from ChordSheetJS items goes to pinyin first; CJK lines are reclassified below.
  const textAsPinyin = (options?.textAsPinyin ?? false) || bothPinyinAndLyrics;
  const rawTabContent = options?.rawTabContent;
  const sectionLabelsFromRaw: string[] = [];
  if (rawTabContent) {
    const matchAll = rawTabContent.match(/^\s*\[([^\]]+)\]\s*$/gm);
    if (matchAll) {
      matchAll.forEach((line) => {
        const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (m) sectionLabelsFromRaw.push(m[1].trim());
      });
    }
  }
  let sectionLabelIndex = 0;
  /** When we see a paragraph that is only a section header line (e.g. [Verse]), assign that label to the next content paragraph. */
  let pendingSectionLabel: string | undefined;

  const paragraphs: EcbParagraph[] = [];

  for (const para of song.bodyParagraphs ?? []) {
    const lines: EcbLine[] = [];
    for (const line of para.lines ?? []) {
      const segments: EcbSegment[] = [];
      for (const item of line.items ?? []) {
        if ('chords' in item || 'lyrics' in item) {
          const chord = (item.chords != null ? String(item.chords) : '').trim();
          // Preserve spaces (e.g. "dang " + "tian " -> "dang tian ") for round-trip
          const text = item.lyrics != null ? String(item.lyrics) : '';
          const lyrics = textAsPinyin ? '' : text;
          const pinyin = textAsPinyin ? text : '';
          segments.push({ chord, lyrics, pinyin, translation: '' });
        }
      }
      lines.push({ segments });
    }

    // --both mode: CJK-only lines (no chords, text contains double-width chars) are merged as
    // lyrics into the preceding chord+pinyin line by splitting on column-width boundaries.
    // Standalone CJK lines with no preceding chord line (e.g. Chinese title) are reclassified
    // from pinyin -> lyrics in place.
    if (bothPinyinAndLyrics) {
      const merged: EcbLine[] = [];
      for (const ecbLine of lines) {
        const lineText = ecbLine.segments.map((s) => s.pinyin ?? '').join('');
        const allChordsEmpty = ecbLine.segments.every((s) => !(s.chord ?? ''));
        if (allChordsEmpty && hasCJK(lineText)) {
          const prev = merged.length > 0 ? merged[merged.length - 1] : null;
          const prevHasContent =
            prev !== null &&
            prev.segments.some((s) => (s.chord ?? '') || (s.pinyin ?? '').trim());
          if (prevHasContent && prev) {
            // Distribute Chinese characters across the previous line's segments
            const widths = prev.segments.map((s) =>
              Math.ceil(Math.max(strColWidth(s.chord ?? ''), strColWidth(s.pinyin ?? ''), 1))
            );
            const splits = splitByCumulativeWidths(lineText, widths);
            prev.segments.forEach((seg, i) => {
              seg.lyrics = (splits[i] ?? '').trimEnd();
            });
            continue; // consumed; do not add as its own line
          }
          // No preceding chord+pinyin line — reclassify as lyrics
          ecbLine.segments.forEach((seg) => {
            seg.lyrics = seg.pinyin ?? '';
            seg.pinyin = '';
          });
        }
        merged.push(ecbLine);
      }
      lines.length = 0;
      merged.forEach((l) => lines.push(l));
    }

    const allText = lines.map((l) => l.segments.map((s) => (textAsPinyin ? s.pinyin : s.lyrics)).join('')).join('').trim();

    // ChordSheetJS may set para.label to the section name (e.g. 'Chorus') on both section-header
    // paragraphs and mixed header+content paragraphs. Prefer it over the inherited pendingSectionLabel
    // so switching sections always picks up the correct new label.
    const paraLabel = (para as { label?: string | null }).label;
    const newParaLabel = paraLabel != null && String(paraLabel).trim() !== '' ? String(paraLabel).trim() : undefined;

    // If any line is exactly [SectionName], use it as this paragraph's label and remove that line (ChordSheetJS may put the header on the first or second line).
    let label: string | undefined = newParaLabel ?? pendingSectionLabel;
    let linesToPush = lines;
    let skipParagraph = false;
    const sectionHeaderRe = /^\[([^\]]+)\]$/;
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i].segments.map((s) => (textAsPinyin ? s.pinyin : s.lyrics)).join('').trim();
      const m = lineText.match(sectionHeaderRe);
      if (m) {
        const sectionName = m[1].trim();
        linesToPush = lines.slice(0, i).concat(lines.slice(i + 1));
        if (linesToPush.length === 0) {
          pendingSectionLabel = sectionName;
          if (sectionLabelIndex < sectionLabelsFromRaw.length && sectionLabelsFromRaw[sectionLabelIndex] === sectionName) {
            sectionLabelIndex += 1;
          }
          // Emit a paragraph for this section so we don't lose the title (e.g. [Interlude] then [Chorus] with no content).
          paragraphs.push({ label: sectionName, lines: [] });
          skipParagraph = true;
        } else {
          label = sectionName;
          pendingSectionLabel = sectionName; // so following lines in this section get the same label
          if (sectionLabelIndex < sectionLabelsFromRaw.length && sectionLabelsFromRaw[sectionLabelIndex] === sectionName) {
            sectionLabelIndex += 1;
          }
        }
        break;
      }
    }
    if (skipParagraph) continue;

    // Empty paragraph whose entire text is blank and ChordSheetJS provided a section label: it is a
    // section-header-only paragraph (e.g. [Interlude] with no content). Update pendingSectionLabel and
    // emit a labeled empty paragraph so header-only sections are preserved in the output.
    if (allText === '' && newParaLabel !== undefined) {
      pendingSectionLabel = newParaLabel;
      paragraphs.push({ label: newParaLabel, lines: [] });
      continue;
    }
    // Empty paragraph with section type but no text and no ChordSheetJS label (fallback for older ChordSheetJS builds).
    if (label === undefined && linesToPush.length === 0 && allText === '' && (para.type ?? 'none') !== 'none' && sectionLabelIndex < sectionLabelsFromRaw.length) {
      const sectionLabel = sectionLabelsFromRaw[sectionLabelIndex];
      sectionLabelIndex += 1;
      if (paragraphs.length > 0) {
        const last = paragraphs[paragraphs.length - 1];
        // Only assign to previous paragraph if it looks like a chord/lyric block (multiple segments with chords), not title/metadata
        const lastHasChordBlock = last.lines.some(
          (l) => l.segments.filter((s) => looksLikeChordSymbol(s.chord ?? '')).length >= 2
        );
        if (last.label === undefined && lastHasChordBlock) {
          last.label = sectionLabel;
        }
      }
      pendingSectionLabel = sectionLabel;
      continue;
    }

    // Paragraph is a chord/lyric block if it has a line with 2+ chord symbols (excludes metadata like title, Capo=4)
    const isChordOrLyricBlock = linesToPush.some(
      (l) => l.segments.filter((s) => looksLikeChordSymbol(s.chord ?? '')).length >= 2
    );
    // Assign next section label when this paragraph has chord-block content but no label (ChordSheetJS may put section headers after the block)
    if (label === undefined && sectionLabelsFromRaw.length > 0 && sectionLabelIndex < sectionLabelsFromRaw.length && isChordOrLyricBlock) {
      label = sectionLabelsFromRaw[sectionLabelIndex];
      sectionLabelIndex += 1;
    }
    if (label === undefined && sectionLabelsFromRaw.length > 0 && (para.type ?? 'none') !== 'none') {
      if (sectionLabelIndex < sectionLabelsFromRaw.length) {
        label = sectionLabelsFromRaw[sectionLabelIndex];
        sectionLabelIndex += 1;
      }
    }
    // Don't use an inherited pending label for metadata-like paragraphs (no chord block); leave it for the next real block.
    // But always honour a label that ChordSheetJS set explicitly on this paragraph (newParaLabel).
    if (newParaLabel === undefined && label === pendingSectionLabel && !isChordOrLyricBlock) {
      label = undefined;
    }
    // Keep pendingSectionLabel in sync so continuation paragraphs (para.label=null) in the same section
    // inherit the correct label, even when the section changed via a mixed header+content paragraph.
    if (label !== undefined) {
      pendingSectionLabel = label;
    }

    paragraphs.push({
      ...(label !== undefined && { label }),
      lines: linesToPush,
    });
  }

  return mergeConsecutiveSectionsWithSameLabel(stripEmptySegmentsAndLines(paragraphs));
}

function segmentHasContent(seg: EcbSegment): boolean {
  return !!(seg.chord?.trim() || seg.lyrics?.trim() || seg.pinyin?.trim() || seg.translation?.trim());
}

/** True if the line has at least one segment with a real chord symbol. */
function lineHasChord(segs: EcbSegment[]): boolean {
  return segs.some((s) => looksLikeChord(s.chord ?? ''));
}

function buildSegmentStr(
  seg: EcbSegment,
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

/**
 * Convert a ChordSheetJS Song directly to an ECB string, aligning chords/lyrics/pinyin
 * and rendering ECB output in one pass (no Ir/IrParagraph/IrLine/Segment tree involved).
 */
export function songToEcb(
  song: { metadata?: Record<string, unknown>; bodyParagraphs?: Array<{ type?: string; lines?: Array<{ items?: Array<{ chords?: string; lyrics?: string }> }> }> },
  options?: SongToEcbOptions
): string {
  const paragraphs = buildParagraphs(song, options);

  // Auto-detect which fields are populated across all segments
  let hasLyrics = false;
  let hasPinyin = false;
  let hasTranslation = false;
  for (const para of paragraphs) {
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
  for (const para of paragraphs) {
    for (const ecbLine of para.lines) {
      const segs = ecbLine.segments.filter(segmentHasContent);
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
