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

/**
 * Convert a ChordSheetJS Song to our IR (with empty pinyin slots).
 */
export function songToIr(song: { metadata?: Record<string, unknown>; bodyParagraphs?: Array<{ type?: string; lines?: Array<{ items?: Array<{ chords?: string; lyrics?: string }> }> }> }): Ir {
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
          const lyrics = (item.lyrics != null ? String(item.lyrics) : '').trim();
          segments.push({ chord, lyrics, pinyin: '' });
        }
      }
      lines.push({ segments });
    }
    paragraphs.push({
      type: (para.type ?? 'none') as IrParagraph['type'],
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

    for (const irLine of para.lines) {
      const items = (irLine.segments ?? []).map(
        (seg) => new ChordLyricsPair(seg.chord ?? '', seg.lyrics ?? '')
      );
      if (items.length === 0) {
        items.push(new ChordLyricsPair('', ''));
      }
      const line = new Line({ type: lineType, items });
      lines.push(line);
    }

    if (p < ir.paragraphs.length - 1) {
      lines.push(new Line({ type: toChordSheetType('none'), items: [] }));
    }
  }

  song.lines = lines;
  return song;
}

/**
 * Serialize IR to LM-friendly text: tab-separated chord, lyrics, pinyin per line; [Section] headers.
 */
export function irToLmText(ir: Ir): string {
  const out: string[] = [];
  if (ir.meta && Object.keys(ir.meta).length > 0) {
    Object.entries(ir.meta).forEach(([k, v]) => {
      if (v != null && typeof v === 'string' && v.trim()) out.push(`${k}: ${v}`);
    });
    out.push('');
  }
  for (const para of ir.paragraphs) {
    const typeLabel = para.type === 'none' ? '' : `[${para.type}]`;
    if (typeLabel) out.push(typeLabel);
    for (const line of para.lines) {
      for (const seg of line.segments) {
        out.push([seg.chord ?? '', seg.lyrics ?? '', seg.pinyin ?? ''].join('\t'));
      }
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Parse LM text back to IR (e.g. after the LM filled pinyin).
 */
export function lmTextToIr(text: string): Ir {
  const lines = text.split(/\r?\n/);
  const meta: Ir['meta'] = {};
  const paragraphs: IrParagraph[] = [];
  let currentParagraph: IrParagraph | null = null;
  let currentLineSegments: Segment[] = [];

  function flushLine(): void {
    if (currentLineSegments.length > 0) {
      if (!currentParagraph) {
        currentParagraph = { type: 'none', lines: [] };
        paragraphs.push(currentParagraph);
      }
      currentParagraph.lines.push({ segments: currentLineSegments });
      currentLineSegments = [];
    }
  }

  function flushParagraph(): void {
    flushLine();
    currentParagraph = null;
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('[') && line.endsWith(']')) {
      flushParagraph();
      const type = line.slice(1, -1).trim() || 'none';
      currentParagraph = { type, lines: [] };
      paragraphs.push(currentParagraph);
      continue;
    }
    if (/^[a-zA-Z0-9_-]+:\s*.+/.test(line)) {
      const idx = line.indexOf(':');
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      meta[key] = value;
      continue;
    }
    if (line === '') {
      flushParagraph();
      continue;
    }
    const parts = line.split('\t');
    const chord = (parts[0] ?? '').trim();
    const lyrics = (parts[1] ?? '').trim();
    const pinyin = (parts[2] ?? '').trim();
    currentLineSegments.push({ chord, lyrics, pinyin });
  }
  flushParagraph();

  return { meta, paragraphs };
}
