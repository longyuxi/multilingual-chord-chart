# The timestamp pipeline

`npm run timestamps` writes line-level `@M:SS` markers into a song: it aligns
the lyrics already in the `.ecb` against the audio of the video that file
embeds, and writes one standalone marker per anchored lyric line.

`docs/timestamps-contract.md` is the module-boundary note the stages were built
against (one module per stage, shared types in `src/timestamps/types.ts`). This
file is the pipeline-level description: what runs in what order, what it costs,
what it caches, how it fails, and the numbers the live runs produced.
For the operational recipe see `.claude/skills/add-timestamps/SKILL.md`.

## Prerequisites

| Requirement | Why | Version that is known to work |
| --- | --- | --- |
| `yt-dlp` | downloads the embedded video's audio | **>= 2026.10.x**. Homebrew's `2026.10.21_1` is verified; `2025.05.22` cannot download at all (see the SABR row in [Failure modes](#failure-modes)). Install user-level with `uv tool install yt-dlp` (or `brew upgrade yt-dlp`) so a new binary takes precedence over an old system copy, and confirm with `yt-dlp --version`. |
| `ffmpeg` + `ffprobe` | yt-dlp's `-x --audio-format mp3` needs ffmpeg; every duration in the pipeline is an `ffprobe` reading | any current build (verified on FFmpeg 8.0.1) |
| Node **>= 20** | the provider adapters use the global `fetch`, `FormData` and `Blob` | verified on v22 |
| `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` in a gitignored `.env` | the paid stage; read by `src/timestamps/env.ts` | provisioning is a human task, tracked on `tab-pinyinizer-ilg.14` |
| `npm run build:cli` | `timestamps`, `check-timestamps` and `golden-timestamps` all run compiled output from `dist/` | — |

`check-timestamps` and `golden-timestamps` need neither yt-dlp nor
ffmpeg/ffprobe: they are offline, so they work on a fresh clone with only
`npm install` + `npm run build:cli` (Node is still required -- they are the
compiled `dist/` scripts).

## The audio must be the embedded video

Every time the pipeline emits is **relative to the embedded video's 0:00**, so
the audio always comes from the `%%youtube` id in the same `.ecb` file
(`src/timestamps/audio.ts`). A separately sourced studio master is never
substituted: the two mixes differ in length and intro, and every seek in the
viewer would silently land somewhere else. A file without a usable `%%youtube`
line is therefore *skipped*, never estimated from another recording — see
[Failure modes](#failure-modes).

`src/timestamps/cli.ts` enforces this: it re-reads `%%youtube` through
`normalize.ts` and refuses to continue if the two parsers disagree, because
timing one video's lyrics against another's audio produces plausible-looking
markers that are all wrong.

## Stages and data flow

```
songs/a.ecb
   │  audio.ts         %%youtube id -> yt-dlp -> .cache/timestamps/audio/<videoId>.mp3
   │                   (duration via ffprobe)                        [network: download only]
   ├─ normalize.ts     primary-language lyric lines -> NormalizedLyrics {lineIndex, text,
   │                   syllables, lyricHash}                         [offline]
   ├─ providers/*.ts   ASR/forced alignment -> AsrResult (tokens in seconds)
   │                   cached as asr/<videoId>/<provider>-<model>-<source>-<lyricHash>.json
   │                                                                [network: paid once]
   ├─ align.ts         monotonic affine-gap DP over syllables x tokens -> AlignReport
   │                   (per-line start/end/confidence/flags)          [offline, deterministic]
   ├─ repair.ts        optional: LLM patch over flagged lines only -- for lines
   │                   nothing anchored, not a refiner                [network: paid, small]
   ├─ ecb-timestamps.ts  strip every existing marker, insert one standalone @M:SS per
   │                   anchored line -> write the .ecb                [offline]
   └─ check.ts         `npm run check-timestamps`: re-read the written markers and bound
                       their order/rate/duration                       [offline]
```

Per module:

- **`audio.ts`** — parses `%%youtube`, downloads to
  `.cache/timestamps/audio/<videoId>.mp3` (via a `.download.mp3` temp file
  renamed only on success, so a killed download can never be mistaken for a
  cache hit), and reads the duration with `ffprobe`. Debug entry point:
  `node dist/timestamps/audio-cli.js songs/a.ecb [--force]`.
- **`normalize.ts`** — the known-lyrics side. The matching track is the first
  `%%languages` entry containing CJK; a pinyin or translation track is never a
  candidate. One CJK character is one syllable (`pinyin.ts` turns it into
  toneless pinyin, so ASR homophone errors become matches instead of misses);
  latin words are split with the same function on both sides. The file's own
  pinyin track is deliberately *not* used for matching — the provider side has
  no pinyin, and two tokenizations would only add mismatches. `lyricHash` is a
  sha256 of the matching-language text alone.
- **`providers/*.ts`** — one adapter per paid timing source, plus the
  cache-first `resolveAsrResult`. Adapters are pure mappers over a parsed
  payload, so they are testable against `providers/__fixtures__/` with no key
  and no spend.
- **`align.ts`** — Needleman-Wunsch over toneless pinyin with separate
  gap-open/gap-extend costs, so a skipped line or a burst of ad-libs is one
  event rather than a run of single gaps. Flags come out of here:
  `low-confidence` (< 0.6 of the line's syllables matched), `unanchored`,
  `syllables-per-sec-low` / `-high` (outside 1.2–7, the same bounds the
  verifier uses), and `repeat-suspected` (>= 8s of unclaimed audio, i.e. what a
  repeated section looks like after a monotonic pass).
- **`repair.ts`** — the only LLM in the pipeline, and it never edits the file.
  It is given the song's section ranges plus, for each *flagged* line, the raw
  ASR tokens within ±`--repair-max-shift` seconds (default 5) of that line's
  anchor, and may return `{line, time}` or `{line, drop}` entries for those
  lines only. `applyPatch` re-validates the whole patch against the evidence
  the model was shown — unknown line, unflagged line, duplicate line,
  non-finite/negative/past-the-end time, a move beyond the shift bound, or a
  timeline that stops increasing — and rejects it *entire*, so a bad model day
  costs one failed run and never a corrupted file. The prompt is
  `prompts/fix_timestamps.md`; the model is `TIMESTAMP_REPAIR_MODEL`
  (default `gpt-4o-mini`).

  **It is a tool for lines nothing anchored, not a refiner — and it is
  net-negative once coverage is complete.** It may only move a line or drop it,
  and `applyPatch` accepts a drop (the guardrails re-check monotonicity, not
  coverage), so with every line already anchored its best case is a <=1 s move
  and its worst is a lost line. Measured with ElevenLabs: on `fathers_prose_poem`
  it dropped `[Am]止` (anchored, and matched by both providers in its window) and
  on `wind_over_the_wheat_field` it dropped the last hum line — 66/67 and 25/26,
  both songs *failing* the song standard afterwards. Use it where the primary
  provider left something unanchored; do not reach for it to nudge a timeline
  that already has one marker per line.
- **`ecb-timestamps.ts`** — emission; see [Marker policy](#marker-policy).
- **`check.ts`** — `npm run check-timestamps`, the offline verifier; see
  [Verification](#verification).
- **`paths.ts` / `env.ts` / `pinyin.ts` / `ecb-markers.ts` / `types.ts`** —
  shared contracts: cache paths and the paid-call key, `.env` loading and
  actionable missing-key errors, the syllable tokenizer both sides use, and the
  CLI-side `@M:SS` grammar (a twin of `src/web/ecb-viewer-parser.ts`, which the
  CLI build may not import).

## Providers

| Provider | Role | Price | Status |
| --- | --- | --- | --- |
| ElevenLabs `POST /v1/forced-alignment` (`scribe_v1`) | **primary** | US$0.22 / audio hour (Scribe rates) | verified end-to-end: every lyric line anchored on all five songs tried, no `--repair` — see below |
| OpenAI `whisper-1` `verbose_json` + `timestamp_granularities[]=word` | independent corroboration | US$0.006 / audio minute (US$0.36 / audio hour) | verified end-to-end; it is the golden fixture, and the stream to fall back on when the primary is unavailable |
| `gpt-4o-transcribe` | **excluded on purpose** | — | returns segment-level times with no word timestamps, so there is nothing to align syllables against; `assertWordTimestampModel` throws rather than degrading silently |
| YouTube auto-captions (`youtube-auto`) | planned free fast-fail probe, never a dependency | free | **not built** (`tab-pinyinizer-ilg.11`); the provider type exists, `createAsrClient` throws for it |
| Demucs vocal separation (`vocals` stem) | planned escalation for noisy mixes | — | **not built** (`tab-pinyinizer-ilg.12`); `--stems auto\|always\|never` is accepted and validated but times the raw audio regardless, and says so on every run |

Why ElevenLabs is primary: it returns per-character times (one Chinese
character is one sung syllable, so those are already syllable-level), a
per-token `loss` the aligner can weigh against its own text match, and it
supports Chinese. For a latin song its character stream would degrade into
per-letter tokens that can never match a lyric word, so those payloads use the
per-word stream instead (`mapElevenLabsResponse`).

Why whisper-1 anyway: it is a second, independent opinion on *when* a syllable
happens — its text is deliberately unused, so a mishearing cannot rewrite a
lyric — a song's whole alignment costs a few US cents either way (US$0.36 vs
US$0.22 per audio hour: whisper-1 is the *pricier* of the two per hour, it is
only "$0.006/min" because it is quoted per minute), and it is what the golden
fixture was recorded from. It is **not** the provider to reach for first: where
it fails, it fails by collapsing (see below).

**ElevenLabs forced alignment is verified end-to-end** — the provisioned key
now carries the `forced_alignment` scope (`HTTP 401 missing_permissions` was the
state before that). It reached **one marker per lyric line with no `--repair`**
on every song tried: `mercury_records` 62/62, `fathers_prose_poem` 67/67,
`wind_over_the_wheat_field` 26/26, `condensed_blue_whale` 43/43 and `vincent`
52/52, each with 0 unanchored lines, 0 errors from `check-timestamps`, and a
passing `audit-songs`; a song costs US$0.015–0.02. Two things it does **not**
buy you:

- **Its confidence is not evidence.** On a Chinese song ElevenLabs' per-character
  `loss` is low enough that confidence comes out near 1.00 on every line, so
  `low-confidence` and `unanchored` can barely fire on it; on a latin song the
  per-*word* `loss` runs 0.8–1.6, which under the loss penalty is a confidence of
  ~0.2, so every line is flagged while every lyric word matched. Read the flag in
  the light of the language, and check the markers themselves.
- **It is not more accurate than whisper.** Against `condensed_blue_whale`'s 8
  hand markers it lands 5 of 8 within 1.5 s, whisper 6 of 8 — both late by
  +1..+2 s. It is primary for *coverage* (no collapsed verses, no zero-duration
  spans), not because its onsets win.

`--provider` takes `elevenlabs` (default) or `whisper-1`; the model is implied
by the provider and recorded in the cache key, so the two streams never
overwrite each other.

## Cache

Everything reproducible lives in `.cache/timestamps/` (gitignored):

```
.cache/timestamps/
  audio/<videoId>.mp3            # the embedded video's audio, as downloaded
  audio/<videoId>.vocals.mp3     # reserved for the demucs stem (ilg.12); never written today
  asr/<videoId>/<provider>-<model>-<source>-<lyricHash16>.json
```

Example: `asr/t-m6CzYu3go/whisper-1-whisper-1-raw-591d2d3f6948806e.json`.

**The invariant: a paid call is keyed by `(videoId, provider, model, source,
lyricHash)`, and `--force` is the only way past that key.** Re-running with
unchanged lyrics never re-bills; editing a pinyin or translation track does not
invalidate anything, because `lyricHash` covers only the matching-language
text. A `--force` run still overwrites the cached artifact, so a stale result
cannot be served afterwards. A corrupt cache file is treated as a miss rather
than a crash.

Deleting `.cache/` is always safe: it costs a re-download and, if the ASR
result is gone with it, a re-bill.

## Marker policy

- **One marker per lyric line**, on its own line directly above the lyric line
  it annotates (never above a blank line — a blank line abandons a marker, per
  `prompts/general_spec.md`). The marker line is the whole annotation, so every
  lyric line's chords and language columns stay byte-identical; the pinyin and
  syllable-matched-translation tooling downstream is unaffected.
- **Whole-second flooring** (`formatMarker`): `@1:37`, never `@1:37.4`. That
  matches the existing hand-made markers and is what makes a re-run
  byte-stable.
- **Strictly increasing**: two markers in one second say nothing extra, so a
  line that floors to the same second as the previous marker is skipped. A
  report that moves *backwards* in time throws instead of writing a file whose
  markers decrease. A skip here is a provider symptom, not a marker-resolution
  one: it means the aligner gave that line the same start as the line before it
  (see [Marker density](#marker-density)).
- **`--min-gap S` / `--density every-line|sparse`** thin the set: `0` (the
  default, `every-line`) marks every anchored line, `sparse` is a 12-second
  minimum — the hand-made style of `songs/condensed_blue_whale.ecb`. An explicit
  `--min-gap` overrides the preset.
- **`--pad-start S`** shifts every marker by a known lead-in before flooring
  (negative pulls earlier; clamped at `@0:00`).
- **One marker owner per file.** A run strips *every* marker already in the
  file before inserting — previous runs' standalone markers *and* hand-made
  inline ones (`[C]卷起 @1:52`). An inline marker is a fixed point a
  regenerated standalone set cannot respect: the file would carry two marker
  sources that disagree, and `check-timestamps` would reject the result as
  non-monotonic. A run on a timestamped file therefore rewrites its markers; the
  CLI prints how many inline markers it removed, and a hand-authored one can be
  recovered from git history (`git show <ref>:songs/<name>.ecb`).
- **Idempotent**: a second run over the same file and the same cached ASR
  result is byte-identical — the run reports `already up to date` and writes
  nothing.
- **Nothing anchored means nothing written**: if no line gets a marker, the file
  is left exactly as it was, markers included.

## Failure modes

| Symptom | What it means | What to do |
| --- | --- | --- |
| `skipped: no %%youtube line` / `skipped: %%youtube does not carry a usable video id`, exit **0** | the song has no embedded video to time against | not an error. Leave it alone; do **not** invent a `%%youtube` id or point it at a different recording — the markers would be relative to the wrong audio. Report it and move on. |
| `yt-dlp download of <id> failed:` + `ERROR: ... The page needs to be reloaded` | the installed yt-dlp is too old: YouTube now forces SABR streaming for the client it still knows about (yt-dlp issue 12482; Homebrew's `2025.05.22` is affected) | upgrade yt-dlp (`uv tool install yt-dlp` / `brew upgrade yt-dlp`) and re-run. Nothing about the song or the lyrics is wrong; do not "work around" it by substituting audio. |
| `ffprobe`/`yt-dlp` `is not installed or not on PATH` | missing prerequisite | install it; the error names the command. |
| `ELEVENLABS_API_KEY is not set. Add it to <repo>/.env ...` / the `OPENAI_API_KEY` equivalent, exit **2** | credential missing; checked *before* any song is read, so nothing is downloaded or billed | a human must provision the key (`tab-pinyinizer-ilg.14`). Note this check also runs under `--dry-run`: a dry run is free, but it still wants the key variable to exist. |
| `ElevenLabs forced alignment failed: HTTP 401 ... missing_permissions` | the key is valid but lacks the `forced_alignment` scope — this was the state before the key was re-provisioned, so it means the key has been rotated onto one without the scope | re-provision the key with that scope, or run `--provider whisper-1` in the meantime. Do not retry in a loop. |
| `alignment report is not monotonic -- line N starts at Xs, before the Ys marker already emitted` | an upstream stage produced decreasing times (a bug or a bad repair patch) | the file is left untouched; nothing is written. Report it rather than hand-editing the markers to fit. |
| `repaired markers would not verify (...); refusing to write` | the repair patch produced an invalid timeline | the file is untouched. Re-run without `--repair` to see the aligner's own output, and treat the flagged line as editorial work. |
| lines reported `unanchored` / flagged | some lyric lines have no confident anchor: a cut verse, a spoken aside, a translation block, or a section sung more times than the file lists | read the flag against the provider you used. Whisper fails here by *collapsing* — `mercury_records` had 4 lines on the identical 29.98 s start with 0.00 s spans, one absorbing a 29.86 s stretch — which is a whisper problem, not a lyric problem; ElevenLabs anchors those same 4 lines at 16.56/20.34/23.90/26.16 s. So the first move is the primary provider, and `--repair` only for what that leaves unanchored (it is net-negative otherwise, see `repair.ts` above). What is left is real information: an unanchored line simply gets no marker, which is a usable file. |
| `repeat-suspected` flags in the middle of a song | the arrangement repeats a section more times than the `.ecb` lists; a monotonic alignment can only match it once, so the later performance looks like unclaimed audio | **flagged, not solved.** Do not move lines into the repeat: the fix is a file edit (list the missing section), which the pipeline will not make. The repair prompt is told to report this in `notes` and leave the lines alone. |
| `check-timestamps` warnings (`syllables-per-sec-low`, `empty-line-marker`) | a marker is probably a second or two early, or sits on an instrumental segment | warnings, not errors. Look at the line in the viewer; fix by re-running with `--pad-start`, or accept it. Only `out-of-order`, `duplicate-time` and `out-of-range` are hard errors (exit 1). |

Exit codes are consistent across the three scripts: **0** success (including
skips and warnings), **1** a song failed / a dry run could not price a song /
hard errors found / the golden bar was not met, **2** could not start (bad
usage, missing file, missing key).

## Verification

1. **`npm run check-timestamps [songs/a.ecb ...]`** — offline, no key, no
   network, default every `songs/*.ecb`. Hard errors: markers out of order, two
   markers in the same second, a marker past the end of the cached audio
   (duration bound only; skipped with a note when no audio is cached). Warnings:
   a marker on an empty/instrumental segment, and implausible syllables/sec
   (`--min-syllables-per-sec 1.2` / `--max-syllables-per-sec 7`). `--json` for a
   machine-readable report, `--quiet` for hard errors only.
2. **`npm run golden-timestamps`** — the one falsifiable gate: replays
   normalize → align → emit on `songs/condensed_blue_whale.ecb` against the
   committed whisper-1 fixture (`src/timestamps/__fixtures__/asr/cbs-whisper-1.json`),
   compares the emitted markers with the 8 hand-made ones read from git
   (`d0a87ee:songs/condensed_blue_whale.ecb` — they survive only in history,
   because a real run rewrites a file's markers), and exits 0 only if at least
   **7 of 8** land within **1.5 s**. `--report-only` always exits 0; `--tolerance`
   moves the bar; `--json` for the report.
3. **Human spot-check in the dev viewer** — `npm run dev`, open the song, press
   `n` to hop to the next marker and keep playing; the playhead highlights the
   line currently being sung. This is a **dev-only** aid
   (`import.meta.env.DEV`, `tab-pinyinizer-ilg.9`): the production build has
   neither the hotkey nor the highlight. It is the only check that can tell a
   well-timed marker from a confidently wrong one.

## The measured numbers

One live run, `--provider whisper-1`, on `songs/condensed_blue_whale.ecb`
(video `t-m6CzYu3go`, 276.65 s) — the corroboration stream, kept because it is
what the golden fixture replays:

| Quantity | Value |
| --- | --- |
| provider / model | `whisper-1` / `whisper-1` |
| audio duration | 276.65 s |
| cost | **US$0.0277** |
| markers written | **42** |
| unanchored lines | 0 |
| flagged lines | 18 |
| stale hand-made inline markers replaced | 1 (the `@1:52`) |
| re-run | byte-identical (idempotent, no write) |
| `npm run check-timestamps` | 0 errors, 19 warnings |

`npm run golden-timestamps` on that same song and fixture:

```
  hand    generated  delta   verdict  nearest  lyric line
  @0:40   @0:41      +1.0s   ok       +1.0s    只要 你说
  @0:54   @0:56      +2.0s   MISS     +2.0s    大的浪都 会像
  @1:10   @1:10      0.0s    ok       0.0s     如果 声音
  @1:23   @1:24      +1.0s   ok       +1.0s    语言接近 沉默
  @1:37   @1:40      +3.0s   MISS     +3.0s    如
  @1:52   @1:53      +1.0s   ok       +1.0s    卷起 何  (segment-anchored: nearest emitted marker)
  @2:06   @2:06      0.0s    ok       0.0s     请 用 你的眼神 给 我回应
  @2:20   @2:21      +1.0s   ok       +1.0s    成 为 它的辽阔 它的孤寂

  6 of 8 hand markers within 1.5s (bar: at least 7 of 8) -- NOT MET (exit 1)
```

So: **6 of 8 within 1.5 s, gate NOT MET** (deltas +1, +2, 0, +1, +3, +1, 0, +1
seconds; the hand `@1:52` is segment-anchored mid-line, so it is compared by
nearest time). The misses are +2 s and +3 s, both *late* in the same direction
as the six that do pass, which is what an onset bias looks like rather than a
misalignment. The fixture is whisper-1 — the corroboration stream, with word
onsets that run late — not the primary source, and the pipeline is not tuned to
this fixture: tuning it until whisper's bias disappeared would fit the wrong
provider. The primary does not rescue the number either: the same 8 hand markers
against an ElevenLabs alignment score **5 of 8** (same late bias), so this gate
is a bias probe, not a provider ranking — and it is unaffected by a re-run of
the song, because the hand markers are read from the `d0a87ee` commit, not from
the working file (`src/timestamps/golden.ts`).

Five live ElevenLabs runs (`--provider elevenlabs`, the default, no `--repair`):

| Song | Audio | Markers / lyric lines | unanchored | flagged | `check-timestamps` | `audit-songs` | cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mercury_records` | 318 s | **62/62** | 0 | 0 | 0 err / 14 warn | PASS | US$0.0194 |
| `fathers_prose_poem` | 334 s | **67/67** | 0 | 0 | 0 err / 12 warn | PASS | US$0.0204 |
| `wind_over_the_wheat_field` | 246 s | **26/26** | 0 | 0 | 0 err / 7 warn | PASS | US$0.0150 |
| `condensed_blue_whale` | 276.7 s | **43/43** | 0 | 20 | 0 err / 21 warn | PASS | US$0.0169 |
| `vincent` | 243.5 s | **52/52** | 0 | 52 | 0 err / 18 warn | PASS | US$0.0149 |

The two rows with flags are the interesting ones. `condensed_blue_whale`'s 20
flags are all `syllables-per-sec-low` — the same verifier noise a dense marker
set always produces. `vincent` is the latin case from the provider section: all
52 lines are `low-confidence` at 0.14–0.19 because a per-word `loss` of 0.8–1.6
scores ~0.2 under the loss penalty, while every lyric word is in fact present in
the token stream — the flag says nothing about that song's timing either way, so
`vincent` is a spot-check in the viewer, not something a green verdict covers.

## Marker density

- **Default `--density every-line`** gives one marker per anchored line. On
  `condensed_blue_whale` that is 43 markers in 276.7 s — roughly one every
  6.4 s — which is what makes the viewer's line highlight and `n`-to-next-line
  worth having.
- **Use `--density sparse` (12 s) when a marker per line is too much**: a very
  fast song, a section where the chart gets noisy, or a song whose markers a
  human placed sparsely by hand and should keep looking that way.
- A gap below **1 s** is never useful: markers are whole-second floored, so a
  sub-second gap collapses to a duplicate and the second marker is dropped at
  emission. Do not read that drop as a resolution limit on the markers: when
  several *lines* land in one second, the aligner is saying it could not tell
  them apart — that is exactly what whisper produced on `mercury_records`
  (four lines on the identical 29.98 s start, 0.00 s spans, 5 markers lost).
  ElevenLabs' own line starts are far apart on those songs (minimum gaps
  0.48–1.34 s, tenth percentile 1.56–2.52 s), so only one pair in 155 lines is
  anywhere near a boundary. A collision is a provider symptom; the fix is the
  primary provider, never a finer marker granularity.
- An explicit `--min-gap` sits between the presets. On a song whose lines
  average 6–7 s (what `condensed_blue_whale` measures), `--min-gap 6` keeps a
  marker on nearly every line and drops only the tightest pairs.

Thinning also reduces verifier noise, which is the practical reason to prefer
it: the same file scores **0 errors / 3 warnings** with its 8 hand markers
(gaps 13–16 s, median 14 s) and **0 errors / 21 warnings** with a full 43-marker set,
because a marker on every line exposes every short or drawn-out line to the
syllables-per-second bounds, while a wider gap lets the skipped lines' syllables
into the measurement.

## Not built yet

- **`youtube-auto`** — the free YouTube auto-caption probe (`tab-pinyinizer-ilg.11`).
  Referenced by the provider type, refused by `createAsrClient`.
- **Demucs vocal separation** (`tab-pinyinizer-ilg.12`) — `--stems` is validated
  and announced as unwired; `audio/<videoId>.vocals.mp3` is reserved in the cache
  layout and never written.
- **Arrangement repeats** — detected and flagged (`repeat-suspected`), never
  solved; that needs a file edit.
