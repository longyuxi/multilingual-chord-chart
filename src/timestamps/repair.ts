// Bounded LLM repair pass for flagged lyric-line timestamps
// (tab-pinyinizer-ilg.10).
//
// The aligner (ilg.4) is the source of truth for every time it can defend. What
// it cannot decide is editorial: is this line sung in this recording at all, or
// did a word bleed in from its neighbour? That judgment is the only thing a
// language model contributes here. It never sees the .ecb, never returns a file,
// and never gets the last word: it proposes a `TimestampPatch` over the flagged
// lines only, this module validates it against the evidence the model was shown,
// and the caller applies the survivors to the report. A patch that breaks any
// rule is rejected whole -- there is no partial trust -- so a model having a bad
// day costs one failed run, never a corrupted timeline.
//
// The model call is one injectable function (`RepairProposer`), which is what
// makes every guardrail here testable with no key and no spend: a fake proposer
// returning a bad patch is turned into a `RepairRejected` the same way a live
// model's would be.

import * as fs from 'fs';
import * as path from 'path';

import { loadDotEnv, requireApiKey } from './env';
import { REPO_ROOT } from './paths';
import type {
  AlignedLine,
  AlignReport,
  AsrResult,
  TimestampFlag,
  TimestampPatch,
  TimestampPatchEntry,
} from './types';

/**
 * Default size of the evidence window, in seconds, on each side of a flagged
 * line's anchor. It is also the shift bound: the model may not move a line
 * further than the audio it was shown, so one number expresses both (the CLI's
 * `--repair-max-shift`).
 */
export const DEFAULT_MAX_SHIFT_SEC = 5;

/**
 * Chat model for the repair pass; `TIMESTAMP_REPAIR_MODEL` overrides it. A
 * repair patch is a few hundred tokens in and a dozen out, so the cheap tier is
 * the right one -- this stage needs reading comprehension, not reasoning depth.
 */
export const DEFAULT_REPAIR_MODEL = 'gpt-4o-mini';

/**
 * The prompt lives in the repo, not in a string literal here: it is the part of
 * this stage a human actually tunes, and it can be edited and re-run without a
 * rebuild (`npm run build:cli` is not needed for a .md file).
 */
export const REPAIR_PROMPT_PATH = path.join(REPO_ROOT, 'prompts', 'fix_timestamps.md');

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

/** One ASR token as the model sees it: toneless pinyin, compact numbers. */
export interface RepairToken {
  text: string;
  /** Toneless pinyin syllables, space-joined (`zhi yao`). */
  pinyin: string;
  start: number;
  end: number;
}

/** One flagged lyric line plus the audio evidence around it. */
export interface RepairLineContext {
  /** 0-based lyric lineIndex; the model echoes this back. */
  line: number;
  section: string;
  text: string;
  flags: TimestampFlag[];
  confidence: number;
  /** The aligner's current start; null when it found no anchor at all. */
  currentStart: number | null;
  currentEnd: number | null;
  /** Centre of `tokens`: `currentStart`, or the nearest anchored neighbour's. */
  anchor: number;
  /** Every ASR token overlapping `anchor ± windowSec`, in time order. */
  tokens: RepairToken[];
}

/** A run of consecutive lyric lines sharing one `<Section>` label. */
export interface RepairSection {
  section: string;
  firstLine: number;
  lastLine: number;
}

/** Everything the model is given, and nothing else. */
export interface RepairInput {
  videoId: string;
  durationSec: number;
  /** Radius of each line's token window, i.e. the largest allowed move. */
  windowSec: number;
  sections: RepairSection[];
  /** One entry per flagged line, in lineIndex order. */
  lines: RepairLineContext[];
}

/** The single model call, injectable so the pass runs offline in tests. */
export type RepairProposer = (input: RepairInput) => Promise<TimestampPatch>;

export interface RepairOptions {
  proposePatch: RepairProposer;
  /** Largest move a patch may make a line's start, in seconds. */
  maxShiftSec?: number;
  log?: (message: string) => void;
}

export type RepairChangeKind = 'moved' | 'anchored' | 'dropped';

/** One line the applied patch changed, for the CLI's report. */
export interface RepairChange {
  line: number;
  from: number | null;
  /** New start; null when the line was dropped. */
  to: number | null;
  kind: RepairChangeKind;
}

export interface RepairResult {
  /** The report to emit from; the input report is never mutated. */
  report: AlignReport;
  /** False when nothing was flagged, so no model call was made. */
  consulted: boolean;
  /** Flagged lines the model was asked about. */
  flagged: number;
  changes: RepairChange[];
  /** The model's own `notes`, or the reason nothing was asked/kept. */
  notes: string;
}

export type RepairRejectionCode =
  | 'malformed-patch'
  | 'line-out-of-range'
  | 'line-not-flagged'
  | 'duplicate-line'
  | 'invalid-time'
  | 'shift'
  | 'monotonicity';

/**
 * A patch the guardrails refused. `code` lets a caller/test name the rule that
 * fired; the message is what a human reads in the run report.
 */
export class RepairRejected extends Error {
  constructor(
    readonly code: RepairRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepairRejected';
  }
}

/** The single bound both directions share: see DEFAULT_MAX_SHIFT_SEC. */
export interface RepairLimits {
  maxShiftSec?: number;
}

export interface AppliedPatch {
  report: AlignReport;
  changes: RepairChange[];
}

/** Model from the environment, defaulting to the model the CLI prices. */
export function repairModel(env: NodeJS.ProcessEnv = process.env): string {
  loadDotEnv();
  const configured = env.TIMESTAMP_REPAIR_MODEL?.trim();
  return configured === undefined || configured === '' ? DEFAULT_REPAIR_MODEL : configured;
}

/** Milliseconds are far finer than the whole-second markers emission writes. */
function round3(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** Prompt text is prose to a human; hundredths of a second are plenty. */
function round2(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/**
 * The time a line's evidence window is centred on: its own start when the
 * aligner anchored it, else the nearest anchored line before it, else the
 * nearest one after it (a skipped intro line), else 0:00.
 *
 * One anchor per line serves both directions -- it bounds the token window the
 * model sees and the largest move the patch may make -- so a proposal can never
 * point outside the audio it was shown.
 */
function anchorStarts(lines: AlignedLine[]): number[] {
  const before = new Array<number | null>(lines.length).fill(null);
  let last: number | null = null;
  for (let position = 0; position < lines.length; position++) {
    if (lines[position].start !== null) last = lines[position].start;
    before[position] = last;
  }

  const anchors = new Array<number>(lines.length).fill(0);
  let next: number | null = null;
  for (let position = lines.length - 1; position >= 0; position--) {
    const own = lines[position].start;
    if (own !== null) {
      next = own;
      anchors[position] = own;
      continue;
    }
    anchors[position] = before[position] ?? next ?? 0;
  }
  return anchors;
}

/** The song's structure: consecutive lines with the same section label. */
function sectionsOf(lines: AlignedLine[]): RepairSection[] {
  const sections: RepairSection[] = [];
  for (const line of lines) {
    const previous = sections[sections.length - 1];
    if (previous !== undefined && previous.section === line.section) {
      previous.lastLine = line.lineIndex;
      continue;
    }
    sections.push({ section: line.section, firstLine: line.lineIndex, lastLine: line.lineIndex });
  }
  return sections;
}

/**
 * The flagged subset of `report`, with each line's ±windowSec of raw ASR tokens
 * and the song's section structure. Nothing unflagged is included, so a line the
 * aligner is sure about cannot be second-guessed.
 */
export function buildRepairInput(
  report: AlignReport,
  asr: Pick<AsrResult, 'tokens'>,
  options: RepairLimits = {},
): RepairInput {
  const windowSec = options.maxShiftSec ?? DEFAULT_MAX_SHIFT_SEC;
  const anchors = anchorStarts(report.lines);

  const lines: RepairLineContext[] = [];
  report.lines.forEach((line, position) => {
    if (line.flags.length === 0) return;
    const anchor = anchors[position];
    const from = anchor - windowSec;
    const to = anchor + windowSec;
    lines.push({
      line: line.lineIndex,
      section: line.section,
      text: line.text,
      flags: [...line.flags],
      confidence: line.confidence,
      currentStart: line.start,
      currentEnd: line.end,
      anchor: round2(anchor),
      tokens: asr.tokens
        .filter((token) => token.end >= from && token.start <= to)
        .map((token) => ({
          text: token.text,
          pinyin: token.pinyin.join(' '),
          start: round2(token.start),
          end: round2(token.end),
        })),
    });
  });

  return {
    videoId: report.videoId,
    durationSec: round2(report.durationSec),
    windowSec,
    sections: sectionsOf(report.lines),
    lines,
  };
}

/**
 * Validates and applies a proposed patch to `report`.
 *
 * Every rule from the prompt is enforced here, because the prompt is advice and
 * this is the boundary: an entry naming a line outside the report, a line the
 * aligner did not flag, the same line twice, a non-finite/negative/past-the-end
 * time, a move beyond `maxShiftSec` from the line's anchor, or a result whose
 * starts no longer strictly increase throws a `RepairRejected` and nothing is
 * applied. Unknown fields are dropped by `normalizePatch` before this runs.
 *
 * A patch only ever changes `start` (and clears both ends when it drops a line):
 * the aligner measured no span for a line it could not anchor, and every
 * consumer of the repaired report -- marker emission -- reads the start alone.
 */
export function applyPatch(
  report: AlignReport,
  patch: TimestampPatch,
  options: RepairLimits = {},
): AppliedPatch {
  const maxShiftSec = options.maxShiftSec ?? DEFAULT_MAX_SHIFT_SEC;
  const anchors = anchorStarts(report.lines);
  const positionOf = new Map<number, number>();
  report.lines.forEach((line, position) => positionOf.set(line.lineIndex, position));

  const patched: AlignedLine[] = report.lines.map((line) => ({ ...line, flags: [...line.flags] }));
  const changes: RepairChange[] = [];
  const claimed = new Set<number>();

  for (const entry of patch.entries) {
    const position = positionOf.get(entry.line);
    if (position === undefined) {
      throw new RepairRejected(
        'line-out-of-range',
        `patch names line ${entry.line}, which is not a lyric line of this report ` +
          `(known: ${report.lines.map((line) => line.lineIndex).join(', ')})`,
      );
    }
    const current = report.lines[position];
    if (current.flags.length === 0) {
      throw new RepairRejected(
        'line-not-flagged',
        `patch names line ${entry.line}, which the aligner did not flag; the repair pass ` +
          'may only touch flagged lines',
      );
    }
    if (claimed.has(entry.line)) {
      throw new RepairRejected('duplicate-line', `patch names line ${entry.line} more than once`);
    }
    claimed.add(entry.line);

    if (entry.drop === true) {
      patched[position].start = null;
      patched[position].end = null;
      changes.push({ line: entry.line, from: current.start, to: null, kind: 'dropped' });
      continue;
    }

    const time = entry.time;
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new RepairRejected(
        'invalid-time',
        `patch gives line ${entry.line} no finite time and does not drop it`,
      );
    }
    if (time < 0) {
      throw new RepairRejected('invalid-time', `patch puts line ${entry.line} at ${time}s, before 0:00`);
    }
    if (time > report.durationSec) {
      throw new RepairRejected(
        'invalid-time',
        `patch puts line ${entry.line} at ${time}s, past the ${round2(report.durationSec)}s of audio`,
      );
    }
    const anchor = anchors[position];
    const shift = time - anchor;
    if (Math.abs(shift) > maxShiftSec + 1e-9) {
      throw new RepairRejected(
        'shift',
        `patch moves line ${entry.line} by ${shift > 0 ? '+' : ''}${round2(shift)}s ` +
          `(${round2(anchor)}s -> ${round2(time)}s), beyond the ${maxShiftSec}s ` +
          'evidence window the model was shown',
      );
    }

    patched[position].start = round3(time);
    changes.push({
      line: entry.line,
      from: current.start,
      to: patched[position].start,
      kind: current.start === null ? 'anchored' : 'moved',
    });
  }

  // The invariant emission relies on: strictly increasing starts, because a
  // marker that moves backwards is a file check.ts rejects outright.
  const ordered = [...patched].sort((a, b) => a.lineIndex - b.lineIndex);
  let previous: AlignedLine | null = null;
  for (const line of ordered) {
    if (line.start === null) continue;
    if (previous !== null && previous.start !== null && line.start <= previous.start) {
      throw new RepairRejected(
        'monotonicity',
        `patch would put line ${line.lineIndex} at ${round2(line.start)}s, not after line ` +
          `${previous.lineIndex} at ${round2(previous.start)}s; markers must strictly increase`,
      );
    }
    previous = line;
  }

  return {
    report: {
      ...report,
      lines: patched,
      unanchored: patched.filter((line) => line.start === null).map((line) => line.lineIndex),
    },
    changes,
  };
}

/**
 * Reads a model reply into a `TimestampPatch`: only `line`, `time` and `drop`
 * survive (every other field is ignored), and anything that cannot be read as
 * one of those throws. `drop: true` keeps its meaning from types.ts -- the time
 * is ignored -- so a reply carrying both is a drop, not an error.
 */
export function normalizePatch(raw: unknown): TimestampPatch {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RepairRejected(
      'malformed-patch',
      'repair model reply is not a JSON object with an `entries` array',
    );
  }
  const body = raw as { entries?: unknown; notes?: unknown };
  if (!Array.isArray(body.entries)) {
    throw new RepairRejected('malformed-patch', 'repair model reply has no `entries` array');
  }

  const entries: TimestampPatchEntry[] = [];
  body.entries.forEach((entry: unknown, index: number) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RepairRejected('malformed-patch', `entry ${index} is not a JSON object`);
    }
    const fields = entry as Record<string, unknown>;
    const line = fields.line;
    if (typeof line !== 'number' || !Number.isInteger(line)) {
      throw new RepairRejected('malformed-patch', `entry ${index} has no integer \`line\``);
    }

    const normalized: TimestampPatchEntry = { line };
    if (fields.time !== undefined) {
      if (typeof fields.time !== 'number' || !Number.isFinite(fields.time)) {
        throw new RepairRejected('invalid-time', `entry for line ${line} has a non-numeric \`time\``);
      }
      normalized.time = fields.time;
    }
    if (fields.drop !== undefined) {
      if (typeof fields.drop !== 'boolean') {
        throw new RepairRejected('malformed-patch', `entry for line ${line} has a non-boolean \`drop\``);
      }
      normalized.drop = fields.drop;
    }
    if (normalized.drop !== true && normalized.time === undefined) {
      throw new RepairRejected(
        'malformed-patch',
        `entry for line ${line} has neither a \`time\` nor \`drop: true\``,
      );
    }
    entries.push(normalized);
  });

  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  return notes === '' ? { entries } : { entries, notes };
}

/** Reads the prompt from `prompts/fix_timestamps.md`; never inlined here. */
export function loadRepairPrompt(file: string = REPAIR_PROMPT_PATH): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `repair prompt is missing: ${file}. The repair pass loads its prompt from disk ` +
        '(prompts/fix_timestamps.md) so it can be edited without rebuilding.',
    );
  }
  return fs.readFileSync(file, 'utf8');
}

/** A chat reply wrapped in a ```json fence, which json_object mode still allows. */
function stripCodeFence(text: string): string {
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text.trim());
  return match === null ? text.trim() : match[1];
}

/**
 * The live proposer: one OpenAI chat completion with JSON output, model from
 * `TIMESTAMP_REPAIR_MODEL`, key from `OPENAI_API_KEY`.
 *
 * Nothing else in this module reaches the network, which is why every guardrail
 * can be exercised by passing a fake proposer to `repairTimestamps`.
 */
export function createOpenAiProposer(options: { model?: string } = {}): RepairProposer {
  return async (input: RepairInput): Promise<TimestampPatch> => {
    const model = options.model ?? repairModel();
    // Checked before the prompt is read or the request built: a missing key must
    // fail in the first second, not after 20 songs have been aligned.
    const apiKey = requireApiKey('OPENAI_API_KEY');

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: loadRepairPrompt() },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`repair model call failed: HTTP ${response.status} ${response.statusText} -- ${detail}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error(`repair model ${model} returned no message content`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch (error) {
      throw new Error(
        `repair model ${model} did not return JSON (${(error as Error).message}): ` +
          content.slice(0, 300),
      );
    }
    return normalizePatch(parsed);
  };
}

/**
 * Runs the repair pass for one song: build the flagged-only input, ask the
 * proposer once, validate and apply its patch.
 *
 * A song with nothing flagged returns the report untouched and `consulted:
 * false` -- no token, no key, no call -- which is what keeps a clean song's run
 * reproducible. Guardrail violations propagate as `RepairRejected` and the
 * caller must not write the file.
 */
export async function repairTimestamps(
  report: AlignReport,
  asr: Pick<AsrResult, 'tokens'>,
  options: RepairOptions,
): Promise<RepairResult> {
  const log = options.log ?? (() => {});
  const flagged = report.lines.filter((line) => line.flags.length > 0);
  if (flagged.length === 0) {
    return {
      report,
      consulted: false,
      flagged: 0,
      changes: [],
      notes: 'no flagged lines: no repair call made',
    };
  }

  const input = buildRepairInput(report, asr, { maxShiftSec: options.maxShiftSec });
  log(
    `repair: asking the model about ${flagged.length} flagged of ` +
      `${report.lines.length} lyric lines`,
  );

  const patch = normalizePatch(await options.proposePatch(input));
  const applied = applyPatch(report, patch, { maxShiftSec: options.maxShiftSec });

  return {
    report: applied.report,
    consulted: true,
    flagged: flagged.length,
    changes: applied.changes,
    notes: patch.notes ?? '',
  };
}
