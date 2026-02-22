/**
 * IR conversion: ChordSheetJS Song ↔ our IR (with optional pinyin).
 * Song uses song.lines (flat array); paragraphs are derived via linesToParagraphs.
 */

import ChordSheetJS from 'chordsheetjs';
import type { Ir, IrLine, IrParagraph, Segment } from './types/ir';

/** ChordSheetJS paragraph type constants (lowercase in our IR, uppercase in lib) */
const PARAGRAPH_TYPE_MAP: Record<string, string> = {
  verse: (ChordSheetJS as unknown as { VERSE: string }).VERSE ?? 'verse',
  chorus: (ChordSheetJS as unknown as { CHORUS: string }).CHORUS ?? 'chorus',
  bridge: (ChordSheetJS as unknown as { BRIDGE?: string }).BRIDGE ?? 'bridge',
  intro: (ChordSheetJS as unknown as { BRIDGE?: string }).BRIDGE ?? 'intro', // no INTRO in lib, use bridge-like
  outro: 'outro',
  none: (ChordSheetJS as unknown as { NONE: string }).NONE ?? 'none',
  indeterminate: (ChordSheetJS as unknown as { INDETERMINATE: string }).INDETERMINATE ?? 'indeterminate',
  tab: (ChordSheetJS as unknown as { TAB: string }).TAB ?? 'tab',
};

function toChordSheetType(irType: string): string {
  const normalized = irType.toLowerCase().trim();
  return PARAGRAPH_TYPE_MAP[normalized] ?? (ChordSheetJS as unknown as { NONE: string }).NONE ?? 'none';
}

/** Capitalise for section header when label is missing: "verse" -> "Verse". */
function sectionLabelFromType(type: string): string {
  const t = type.trim();
  if (!t) return 'Section';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
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
    const paraLabel = (para as { label?: string | null }).label;
    let label: string | undefined =
      paraLabel != null && String(paraLabel).trim() !== '' ? String(paraLabel).trim() : undefined;
    if (label === undefined && sectionLabelsFromRaw.length > 0 && (para.type ?? 'none') !== 'none') {
      if (sectionLabelIndex < sectionLabelsFromRaw.length) {
        label = sectionLabelsFromRaw[sectionLabelIndex];
        sectionLabelIndex += 1;
      }
    }
    paragraphs.push({
      type: (para.type ?? 'none') as IrParagraph['type'],
      ...(label !== undefined && { label }),
      lines,
    });
  }

  return { meta, paragraphs };
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
    const lineType = toChordSheetType(para.type);
    const sectionTitle = para.label ?? sectionLabelFromType(para.type);

    // Emit section header line [Verse 1], [Chorus], etc. (except for type 'none')
    if (para.type !== 'none' && para.type !== 'indeterminate') {
      const titleLine = new Line({
        type: lineType,
        items: [new ChordLyricsPair('', `[${sectionTitle}]`)],
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
