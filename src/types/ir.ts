/**
 * Intermediate representation (IR) for tab-pinyinizer.
 * Alignment is explicit per segment: { chord, lyrics, pinyin? }.
 */

export interface Segment {
  chord: string;
  lyrics: string;
  pinyin: string;
  /** Optional translation (e.g. English). Omitted in rendered text when the line has no translation. */
  translation?: string;
}

export interface IrLine {
  segments: Segment[];
}

export type ParagraphType =
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'intro'
  | 'outro'
  | 'none'
  | 'indeterminate'
  | 'tab'
  | string;

export interface IrParagraph {
  type: ParagraphType;
  /** Section title as in the source, e.g. "Verse 1", "Intro". Used when writing tab. */
  label?: string;
  lines: IrLine[];
}

export interface IrMeta {
  [key: string]: string | undefined;
}

export interface Ir {
  meta: IrMeta;
  paragraphs: IrParagraph[];
}
