export type EcbSegment = {
  chord: string;
  lyrics: string[];
  /**
   * Playback offset in seconds, from an inline `@M:SS` marker written before
   * this segment. Absent on the vast majority of segments — timestamps are
   * sparse and opt-in per segment (tab-pinyinizer-0by).
   */
  time?: number;
};

// `@45`, `@1:30`, `@1:02:03` — bare seconds, M:SS, or H:MM:SS.
const TIMESTAMP_RE = /@(\d+(?::\d+){0,2})/g;

// A line consisting of nothing but a single timestamp marker, e.g. `@0:40` on
// its own line, annotates the first segment of the lyric line that follows it.
const STANDALONE_TIMESTAMP_RE = /^@\d+(?::\d+){0,2}$/;

/** Parses `45` / `1:30` / `1:02:03` into seconds. */
export function parseTimestamp(raw: string): number {
  return raw.split(':').reduce((acc, part) => acc * 60 + parseInt(part, 10), 0);
}

/** Formats seconds as `M:SS` (or `H:MM:SS` past an hour) for display. */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Strips inline `@M:SS` markers out of a run of lyric text, returning the
 * cleaned text and the times found, in order of appearance.
 */
function extractTimes(text: string): { text: string; times: number[] } {
  const times: number[] = [];
  const cleaned = text.replace(TIMESTAMP_RE, (_match, raw: string) => {
    times.push(parseTimestamp(raw));
    return '';
  });
  return { text: cleaned, times };
}

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

  // Set by a standalone `@M:SS` line; consumed by the next lyric line's first
  // segment and abandoned by any other kind of line.
  let standaloneTime: number | undefined;

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

    // A line that is nothing but a timestamp marker annotates the first
    // segment of the lyric line that directly follows it.
    const trimmed = line.trim();
    if (STANDALONE_TIMESTAMP_RE.test(trimmed)) {
      standaloneTime = parseTimestamp(trimmed.slice(1));
      continue;
    }
    const carried = standaloneTime;
    standaloneTime = undefined;

    // Blank line
    if (trimmed === '') {
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

      // A `@M:SS` marker encountered in a run of text annotates the segment
      // that follows it, so it has to be carried across runs: `@0:45 [Am]...`
      // (marker in the leading text) and `[Am]... @1:20 [Dm]...` (marker at the
      // tail of a previous segment's text) both attach to the next segment.
      // A marker carried over from a standalone `@M:SS` line applies to the
      // first segment of this line, unless that segment has its own inline
      // marker, which wins.
      let pending: number | undefined;
      let first = true;

      // Capture leading text before the first bracket
      const firstBracket = line.indexOf('[');
      const leading = extractTimes(line.slice(0, firstBracket));
      pending = leading.times[leading.times.length - 1];
      if (leading.text.trim() !== '') {
        const lyrics = leading.text.trim().split('|').map(s => s.trim());
        const time = pending !== undefined ? pending : (first ? carried : undefined);
        segments.push(time === undefined ? { chord: '', lyrics } : { chord: '', lyrics, time });
        first = false;
        pending = undefined;
      }

      const re = /\[([^\]]*)\]([^\[]*)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const chord = match[1].trim();
        const { text, times } = extractTimes(match[2]);
        const lyrics = text.trim() === ''
          ? Array(numLanguages).fill('')
          : text.trim().split('|').map(s => s.trim());
        const time = pending !== undefined ? pending : (first ? carried : undefined);
        segments.push(time === undefined ? { chord, lyrics } : { chord, lyrics, time });
        first = false;
        pending = times[times.length - 1];
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
