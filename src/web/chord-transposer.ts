import { Chord } from 'chordsheetjs';

export function transposeChord(chord: string, semitones: number): { text: string; valid: boolean } {
  if (!chord.trim()) return { text: chord, valid: true };

  const parsed = Chord.parse(chord);
  if (!parsed) return { text: chord, valid: false };
  if (semitones === 0) return { text: chord, valid: true };

  return { text: parsed.transpose(semitones).toString(), valid: true };
}
