// Toneless-pinyin helpers shared by lyric normalization (ilg.2) and provider
// token normalization (ilg.3). Both sides must agree byte-for-byte on how a
// character becomes a syllable, otherwise identical sounds stop matching.

import { pinyin } from 'pinyin-pro';

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_RUN_RE = /[A-Za-z]+/;

/**
 * Splits text into syllable tokens: each CJK character becomes one toneless
 * pinyin syllable (one character is one sung syllable in Chinese), and each run
 * of latin letters becomes one lowercased token. Punctuation, digits and
 * whitespace are dropped -- they carry no timing and only add DP noise.
 */
export function syllableTokens(text: string): string[] {
  const tokens: string[] = [];
  let latin = '';

  const flushLatin = () => {
    if (latin) tokens.push(latin.toLowerCase());
    latin = '';
  };

  for (const char of text) {
    if (CJK_RE.test(char)) {
      flushLatin();
      tokens.push(...tonelessForChar(char));
    } else if (LATIN_RUN_RE.test(char)) {
      latin += char;
    } else {
      flushLatin();
    }
  }
  flushLatin();
  return tokens;
}

/** Toneless pinyin for a single CJK character; falls back to the char itself. */
function tonelessForChar(char: string): string[] {
  const [syllable] = pinyin(char, { toneType: 'none', type: 'array' }) as string[];
  return [syllable || char];
}

/** Space-joined form, for reports and prompts. */
export function syllableText(text: string): string {
  return syllableTokens(text).join(' ');
}

/** True when the string contains any CJK character. */
export function containsCjk(text: string): boolean {
  return CJK_RE.test(text);
}
