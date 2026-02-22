/**
 * Intermediate representation (IR) for tab-pinyinizer.
 * Alignment is explicit per segment: { chord, lyrics, pinyin? }.
 */

export interface Segment {
  chord: string;
  lyrics: string;
  pinyin: string;
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
  lines: IrLine[];
}

export interface IrMeta {
  [key: string]: string | undefined;
}

export interface Ir {
  meta: IrMeta;
  paragraphs: IrParagraph[];
}
