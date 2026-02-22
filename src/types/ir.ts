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

export interface IrParagraph {
  /** Section title. When non-empty, rendered as [label] in tab output; when empty or missing, no section header is rendered. */
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
