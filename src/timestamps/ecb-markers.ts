// CLI-side `@M:SS` marker handling (tab-pinyinizer-ilg.5, tab-pinyinizer-ilg.7).
// The viewer already parses these markers in src/web/ecb-viewer-parser.ts, but
// tsconfig.json excludes src/web from the CLI build (tab-pinyinizer-xql), so the
// pipeline needs its own copy. Keep the grammar identical to that file.

/** `45`, `1:30`, or `1:02:03`. */
const MARKER_BODY = String.raw`\d+(?::\d+){0,2}`;

/** A line consisting of nothing but one marker, e.g. `@0:40`. */
const STANDALONE_MARKER_RE = new RegExp(`^@(${MARKER_BODY})$`);

/** An inline marker anywhere in a line, e.g. the `@1:52` in `[C]卷起 @1:52`. */
const INLINE_MARKER_RE = new RegExp(`@(${MARKER_BODY})`, 'g');

export interface StandaloneMarker {
  /** 0-based line index of the marker line itself. */
  lineIndex: number;
  /** Seconds from the start of the embedded video. */
  seconds: number;
  /** The marker's own text, e.g. `@0:40`. */
  label: string;
}

/** Parses `45` / `1:30` / `1:02:03` into seconds. */
export function parseMarkerSeconds(raw: string): number {
  return raw
    .replace(/^@/, '')
    .split(':')
    .reduce((acc, part) => acc * 60 + parseInt(part, 10), 0);
}

/**
 * Formats seconds as `M:SS`, or `H:MM:SS` past an hour. Whole-second flooring
 * matches the existing hand-made markers and keeps output byte-stable, which is
 * what makes re-running on an already-timestamped file idempotent.
 */
export function formatMarker(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `@${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** True when the whole line is a single standalone marker. */
export function isStandaloneMarkerLine(line: string): boolean {
  return STANDALONE_MARKER_RE.test(line.trim());
}

/** All standalone markers in the file, in file order. */
export function findStandaloneMarkers(raw: string): StandaloneMarker[] {
  const markers: StandaloneMarker[] = [];
  raw.split('\n').forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!isStandaloneMarkerLine(trimmed)) return;
    markers.push({ lineIndex, seconds: parseMarkerSeconds(trimmed), label: trimmed });
  });
  return markers;
}

/** Seconds of every inline marker in a line, in order of appearance. */
export function inlineMarkerTimes(line: string): number[] {
  const times: number[] = [];
  for (const match of line.matchAll(INLINE_MARKER_RE)) {
    times.push(parseMarkerSeconds(match[1]));
  }
  return times;
}

/** Removes inline markers from a line, leaving the surrounding text intact. */
export function stripInlineMarkers(line: string): string {
  return line.replace(INLINE_MARKER_RE, '');
}
