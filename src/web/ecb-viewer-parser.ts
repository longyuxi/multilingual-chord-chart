export type EcbSegment = {
  chord: string;
  lyrics: string[];
};

export type EcbBlock =
  | { kind: 'config_table'; entries: { key: string; value: string }[] }
  | { kind: 'free_text'; text: string }
  | { kind: 'empty' }
  | { kind: 'section'; label: string }
  | { kind: 'lyric_line'; segments: EcbSegment[] };

export function parseEcbBlocks(raw: string): EcbBlock[] {
  const lines = raw.split('\n');

  // Pre-scan for %%languages to determine numLanguages
  let numLanguages = 1;
  for (const line of lines) {
    const m = line.match(/^%%languages\s+(.+)/);
    if (m) {
      numLanguages = m[1].split(',').length;
      break;
    }
  }

  const blocks: EcbBlock[] = [];
  let configBuffer: { key: string; value: string }[] = [];

  function flushConfig() {
    if (configBuffer.length > 0) {
      blocks.push({ kind: 'config_table', entries: configBuffer });
      configBuffer = [];
    }
  }

  for (const line of lines) {
    // Comments — skip
    if (line === '%' || line.startsWith('% ')) continue;

    // Config lines
    const configMatch = line.match(/^%%(\S+)\s*(.*)/);
    if (configMatch) {
      configBuffer.push({ key: configMatch[1], value: configMatch[2].trim() });
      continue;
    }

    // Non-config line: flush config first
    flushConfig();

    // Blank line
    if (line.trim() === '') {
      blocks.push({ kind: 'empty' });
      continue;
    }

    // Free text
    if (line.startsWith('> ')) {
      blocks.push({ kind: 'free_text', text: line.slice(2) });
      continue;
    }

    // Section title: <Label>
    const sectionMatch = line.match(/^<(.+)>$/);
    if (sectionMatch) {
      blocks.push({ kind: 'section', label: sectionMatch[1] });
      continue;
    }

    // Lyric line: contains [
    if (line.includes('[')) {
      const segments: EcbSegment[] = [];

      // Capture leading text before the first bracket
      const firstBracket = line.indexOf('[');
      const leadingText = line.slice(0, firstBracket);
      if (leadingText.trim() !== '') {
        const lyrics = leadingText.trim().split('|').map(s => s.trim());
        segments.push({ chord: '', lyrics });
      }

      const re = /\[([^\]]*)\]([^\[]*)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const chord = match[1].trim();
        const textPart = match[2];
        const lyrics = textPart.trim() === ''
          ? Array(numLanguages).fill('')
          : textPart.trim().split('|').map(s => s.trim());
        segments.push({ chord, lyrics });
      }
      if (segments.length > 0) {
        blocks.push({ kind: 'lyric_line', segments });
      }
      continue;
    }

    // Fallback: treat as free text
    blocks.push({ kind: 'free_text', text: line });
  }

  flushConfig();

  return blocks;
}
