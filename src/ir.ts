/**
 * IR conversion: ChordSheetJS Song ↔ our IR (with optional pinyin).
 * Song uses song.lines (flat array); paragraphs are derived via linesToParagraphs.
 */

import ChordSheetJS from 'chordsheetjs';
import type { Ir, IrLine, IrParagraph, Segment } from './types/ir';

/** ChordSheetJS paragraph type for lines we emit (IR has no type, we use a default). */
const DEFAULT_CHORDSHEET_LINE_TYPE = (ChordSheetJS as unknown as { VERSE: string }).VERSE ?? 'verse';

/** Heuristic: segment chord looks like a chord symbol (e.g. Am, F#m7), not metadata (Capo=4, title text). */
function looksLikeChordSymbol(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t) return false;
  return /^[A-Ga-g][#b]?\d*[mM]?(maj|min|sus|dim|aug|maj7|min7|add|omit)*\d*(\/[A-Ga-g][#b]?)?$/i.test(t) || /^[A-G][#b]?(maj|min|m|M|sus|dim|aug)?\d*$/i.test(t);
}

function toChordSheetType(_label?: string): string {
  return DEFAULT_CHORDSHEET_LINE_TYPE;
}

export interface SongToIrOptions {
  /** If true, put parsed line text into pinyin and leave lyrics empty. Default: false (text → lyrics). */
  textAsPinyin?: boolean;
  /**
   * Raw tab file content. When set, section titles are extracted from lines like [Verse 1], [Chorus],
   * and assigned to paragraphs in order (so round-trip preserves [Verse 1] etc.).
   */
  rawTabContent?: string;
}

/**
 * Convert a ChordSheetJS Song to our IR (with empty pinyin slots by default).
 * Use textAsPinyin: true to treat the parsed line text as pinyin instead of lyrics.
 */
export function songToIr(
  song: { metadata?: Record<string, unknown>; bodyParagraphs?: Array<{ type?: string; lines?: Array<{ items?: Array<{ chords?: string; lyrics?: string }> }> }> },
  options?: SongToIrOptions
): Ir {
  const textAsPinyin = options?.textAsPinyin ?? false;
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

  const meta: Ir['meta'] = {};
  if (song.metadata && typeof song.metadata === 'object') {
    const m = song.metadata as Record<string, unknown>;
    Object.entries(m).forEach(([k, v]) => {
      if (v != null && typeof v === 'string') meta[k] = v;
    });
  }
  const paragraphs: IrParagraph[] = [];

  for (const para of song.bodyParagraphs ?? []) {
    const lines: IrLine[] = [];
    for (const line of para.lines ?? []) {
      const segments: Segment[] = [];
      for (const item of line.items ?? []) {
        if ('chords' in item || 'lyrics' in item) {
          const chord = (item.chords != null ? String(item.chords) : '').trim();
          // Preserve spaces (e.g. "dang " + "tian " -> "dang tian ") for round-trip
          const text = item.lyrics != null ? String(item.lyrics) : '';
          const lyrics = textAsPinyin ? '' : text;
          const pinyin = textAsPinyin ? text : '';
          segments.push({ chord, lyrics, pinyin });
        }
      }
      lines.push({ segments });
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

  return {
    meta,
    paragraphs: mergeConsecutiveSectionsWithSameLabel(stripEmptySegmentsAndLines(paragraphs)),
  };
}

/** Segment is empty if chord, lyrics, pinyin (and translation) are all empty or whitespace. */
function isSegmentEmpty(s: Segment): boolean {
  const t = (v: string | undefined) => (v ?? '').trim();
  return !t(s.chord) && !t(s.lyrics) && !t(s.pinyin) && !t(s.translation);
}

/** Remove empty segments from each line, then remove lines that have no segments left. Done before merge. */
function stripEmptySegmentsAndLines(paragraphs: IrParagraph[]): IrParagraph[] {
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
function isEmptyUnlabeled(para: IrParagraph): boolean {
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
function mergeConsecutiveSectionsWithSameLabel(paragraphs: IrParagraph[]): IrParagraph[] {
  if (paragraphs.length <= 1) return paragraphs;
  // Collapse empty unlabeled paragraphs into the previous paragraph
  const collapsed: IrParagraph[] = [];
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
  const result: IrParagraph[] = [];
  let current: IrParagraph = { ...collapsed[0], lines: [...collapsed[0].lines] };
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

/** ChordSheetJS Song-like type we build and pass to formatter */
interface BuiltSong {
  lines: unknown[];
  metadata?: Record<string, string>;
}

/**
 * Convert IR back to a ChordSheetJS Song. Uses song.lines (flat array); empty lines between paragraphs.
 */
export function irToSong(ir: Ir): BuiltSong {
  const Song = (ChordSheetJS as unknown as { Song: new () => BuiltSong & { metadata?: Record<string, string> } }).Song;
  const Line = (ChordSheetJS as unknown as { Line: new (opts?: { type?: string; items?: unknown[] }) => unknown }).Line;
  const ChordLyricsPair = (ChordSheetJS as unknown as { ChordLyricsPair: new (chords?: string, lyrics?: string | null) => unknown }).ChordLyricsPair;

  if (!Song || !Line || !ChordLyricsPair) {
    throw new Error('ChordSheetJS did not export Song, Line, or ChordLyricsPair.');
  }

  const song = new Song() as BuiltSong & { metadata?: Record<string, string> };

  if (ir.meta && Object.keys(ir.meta).length > 0 && song.metadata) {
    Object.entries(ir.meta).forEach(([key, value]) => {
      if (value != null && value !== '') song.metadata![key] = value;
    });
  }

  const lines: unknown[] = [];

  for (let p = 0; p < ir.paragraphs.length; p++) {
    const para = ir.paragraphs[p];
    const lineType = toChordSheetType(para.label);
    const labelStr = para.label != null ? String(para.label).trim() : '';

    // Emit section header line [label] only when label is non-empty
    if (labelStr !== '') {
      const titleLine = new Line({
        type: lineType,
        items: [new ChordLyricsPair('', `[${labelStr}]`)],
      });
      lines.push(titleLine);
    }

    for (const irLine of para.lines) {
      const segments = irLine.segments ?? [];
      const items = segments.map(
        (seg) => new ChordLyricsPair(seg.chord ?? '', seg.lyrics ?? '')
      );
      if (items.length === 0) {
        items.push(new ChordLyricsPair('', ''));
      }
      const line = new Line({ type: lineType, items });
      lines.push(line);
      // If any segment has pinyin, emit a second line (chord-free) with pinyin so output shows both lyrics and pinyin.
      const hasPinyin = segments.some((seg) => (seg.pinyin ?? '').trim() !== '');
      if (hasPinyin) {
        const pinyinItems = segments.map(
          (seg) => new ChordLyricsPair('', seg.pinyin ?? '')
        );
        lines.push(new Line({ type: lineType, items: pinyinItems }));
      }
    }

    if (p < ir.paragraphs.length - 1) {
      lines.push(new Line({ type: toChordSheetType('none'), items: [] }));
    }
  }

  song.lines = lines;
  return song;
}
