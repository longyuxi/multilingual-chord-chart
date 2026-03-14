const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type ParsedChord = {
  valid: boolean;
  pitch: string;   // e.g. "C#", "D", ""
  quality: string; // e.g. "m", "maj7", "m9", ""
};

export function parseChord(chord: string): ParsedChord {
  if (!chord.trim()) return { valid: true, pitch: '', quality: '' };

  // First character must be A–G
  if (!/^[A-G]/.test(chord)) return { valid: false, pitch: chord, quality: '' };

  let pitch: string;
  let quality: string;

  if (chord.length >= 2 && (chord[1] === '#' || chord[1] === '♯')) {
    pitch = chord[0] + '#';
    quality = chord.slice(2);
  } else {
    pitch = chord[0];
    quality = chord.slice(1);
  }

  if (!CHROMATIC.includes(pitch)) return { valid: false, pitch: chord, quality: '' };

  return { valid: true, pitch, quality };
}

export function transposeChord(chord: string, semitones: number): { text: string; valid: boolean } {
  if (!chord.trim()) return { text: chord, valid: true };

  const parsed = parseChord(chord);
  if (!parsed.valid) return { text: chord, valid: false };
  if (!parsed.pitch) return { text: chord, valid: true };

  const idx = CHROMATIC.indexOf(parsed.pitch);
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return { text: CHROMATIC[newIdx] + parsed.quality, valid: true };
}
