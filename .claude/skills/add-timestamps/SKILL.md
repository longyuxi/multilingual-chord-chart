---
name: add-timestamps
description: Add line-level @M:SS markers to a song's .ecb file by aligning its existing lyrics to the audio of the YouTube video the file embeds. Use when asked to "add timestamps" / "time this song" for an existing file in songs/ — the target is almost always songs/<name>.ecb with a %%youtube line, not a file to create.
---

Add line-level `@M:SS` markers to a song by driving the repo's timestamp pipeline
(`src/timestamps/`, `npm run timestamps`). Unlike `add-pinyin-to-ecb` this is not a
"follow the prompt by hand" skill: the timing comes from real audio, so the only
honest source of truth is a pipeline run plus the offline verifier plus a human
listening. Your job is to run it, read what it tells you, and report what you
cannot defend.

## Before the first run

- `npm run build:cli` — the three scripts below run `dist/`, not `src/`.
- `yt-dlp` must be **>= 2026.10.x** (`uv tool install yt-dlp`, or
  `brew upgrade yt-dlp`; Homebrew's `2026.10.21_1` is verified, `2025.05.22`
  cannot download at all any more) and `ffmpeg`/`ffprobe` must be on `PATH`.
  Node >= 20. Full list and why: `docs/timestamp-pipeline.md`.
- A provider key in the gitignored `.env` (`OPENAI_API_KEY` for `whisper-1`,
  `ELEVENLABS_API_KEY` for the default `elevenlabs`). Keys are provisioned by a
  **human** — `tab-pinyinizer-ilg.14`. If a key is missing the CLI exits 2 with
  an actionable message before doing any work; do not fake one.
- The song needs a usable `%%youtube` line. Timestamps are always relative to
  **that video's** 0:00; never substitute another recording or a local mp3.

## Workflow

1. **Dry run first, and read the cost.** It spends nothing:

   ```bash
   npm run timestamps -- songs/<name>.ecb --dry-run --provider whisper-1
   ```

   It prints the audio duration, `duration x price/audio-hour` and the total. A
   song with no cached audio cannot be priced without downloading, so add
   `--assume-duration 240` (or whatever the song's length is); without it the
   dry run exits 1 and says so. A `--dry-run` still wants the provider key
   variable to exist — that is a presence check, not a call.

2. **Real run.**

   ```bash
   npm run timestamps -- songs/<name>.ecb --provider whisper-1
   ```

   It downloads the audio, uploads it once, aligns, and writes the markers into
   the file. Read the per-song line it prints: `wrote N markers (M unanchored
   lines, K flagged)`, plus a notice if it replaced hand-made inline markers. Add
   `--density sparse` (one marker per ~12 s) or `--min-gap S` when a marker per
   line is too dense for the chart — see the density note in
   `docs/timestamp-pipeline.md`.

3. **Verify offline.**

   ```bash
   npm run check-timestamps songs/<name>.ecb
   ```

   Exit 0 with warnings is a normal, usable file. Exit 1 means hard errors
   (markers out of order, two markers in one second, markers past the end of the
   audio) — those must be fixed or reported, never hand-patched away.

4. **Human spot-check.** Markers are only as good as someone listening:

   ```bash
   npm run dev
   ```

   Open the song, press `n` to hop to the next marker while it keeps playing,
   and watch the highlighted line. That seek aid is **dev-only** (it is compiled
   out of `npm run build:web`), so it exists exactly for this check. Ask a human
   to do at least a couple of sections before trusting a full set.

5. **Commit the song once a human has confirmed the timing** (or when you are
   explicitly asked to commit as-is). The markers are the pipeline's output, not
   yours; do not edit them by hand to make a check pass.

## Which provider

- `--provider whisper-1` — **use this by default today.** ~US$0.006/min
  (US$0.36/audio hour), verified end-to-end here, and its word timestamps are
  independent of the lyrics, so a mishearing cannot rewrite text (its text is
  never used, only its times).
- `--provider elevenlabs` (the CLI default) — the intended *primary*:
  per-character times plus a per-token `loss`, Chinese supported, US$0.22/audio
  hour. It is **unverified in this repo**: the provisioned key lacks the
  `forced_alignment` scope and returns `HTTP 401 missing_permissions`. Pass
  `--provider whisper-1` explicitly unless that scope has been provisioned, and
  say plainly which provider produced any markers you ship.
- `gpt-4o-transcribe` is not an option: segment-level times only, no word
  timestamps, and the adapter refuses it on purpose.
- The YouTube auto-caption probe and demucs stems are **not built** yet
  (`tab-pinyinizer-ilg.11` / `.12`); `--stems` is accepted but ignored, and the
  run says so.

## Cost, caching, idempotence

Results live in `.cache/timestamps/` (gitignored): `audio/<videoId>.mp3` and
`asr/<videoId>/<provider>-<model>-<source>-<lyricHash>.json`. A paid call is
keyed by `(videoId, provider, model, source, lyricHash)` and `lyricHash` covers
only the matching-language lyric text — so:

- re-running is **free**, and byte-identical: the file gets `already up to
  date` and is not rewritten;
- editing a pinyin or English track does not invalidate the ASR result, but
  editing the Chinese lines does (a new key, a new paid call);
- `--force` is the only way past the cache, and it re-bills. Don't use it
  "just in case".

## Repair path

When the run reports flagged lines, the bounded repair pass can look at them:

```bash
npm run timestamps -- songs/<name>.ecb --provider whisper-1 --repair
npm run timestamps -- songs/<name>.ecb --provider whisper-1 --repair --dry-run   # preview, spends nothing
```

- Only **flagged** lines are sent — a line the aligner is sure about is never
  second-guessed; a song with no flagged lines makes no model call at all.
- Each line is shown the raw ASR tokens within `--repair-max-shift` seconds
  (default 5) of its anchor, and the model (`TIMESTAMP_REPAIR_MODEL`, default
  `gpt-4o-mini`) may only move that line's start within that window or drop it
  as unsung. The patch is re-validated in code; any violation rejects it whole,
  the reason is printed, and the file is left untouched.
- The model never sees or edits the `.ecb`. The prompt is
  `prompts/fix_timestamps.md`; read it if you want to know what it may decide.
- `--dry-run --repair` aligns from the cached audio/ASR and prints the diff it
  would write, without consulting the model. Cheapest way to see whether a
  repair is worth it.

## Failure modes you must not paper over

- **`skipped: no %%youtube line` (exit 0)** — the song has no embedded video, so
  there is nothing to time. Report it. Do not add a `%%youtube` id, and never
  point it at a different recording: the markers would be relative to the wrong
  audio and look plausible.
- **Stale `yt-dlp`** — the download fails with `ERROR: ... The page needs to be
  reloaded` (YouTube forces SABR for the old client). Upgrade `yt-dlp` and
  re-run; it says nothing about the song. Re-running with a "workaround" audio
  file is not a fix.
- **Missing key / missing scope** — the CLI exits 2 with the exact path it wants
  the key in; ElevenLabs may answer `HTTP 401 missing_permissions` when the key
  exists but lacks `forced_alignment`. Both are human provisioning problems
  (`tab-pinyinizer-ilg.14`). Switch to `--provider whisper-1` and say so rather
  than reporting the primary provider as tested.
- **Golden gate failures** — `npm run golden-timestamps` exits 1 whenever fewer
  than 7 of the 8 hand-made `condensed_blue_whale` markers land within 1.5 s.
  That is the gate doing its job, not something to tune away: the fixture is
  whisper-1, the corroboration stream, so its onset bias is expected. Never
  "fix" it by editing the fixture, the hand markers, the tolerance, or the
  aligner's constants; report the number.
- **Flagged / unanchored / `repeat-suspected` lines left after `--repair`** —
  these are information. An unanchored line just gets no marker. A suspected
  arrangement repeat means the `.ecb` lists a section fewer times than the audio
  performs it: that needs a **file edit by a human**, and the pipeline will not
  make it.
- **A run rewrites the file's markers.** Every existing marker is stripped
  before insertion — including hand-made *inline* ones (`[C]卷起 @1:52`) — so
  the file has one marker owner. If a hand-made marker must survive, it has to
  come from git history (`git show <ref>:songs/<name>.ecb`), not from a run.

## Where to read more

- `docs/timestamp-pipeline.md` — stages, cache layout, prerequisites, failure
  modes, marker density advice, and the measured numbers from the one live run.
- `docs/timestamps-contract.md` — the per-module interface note.
- `prompts/fix_timestamps.md` — what the bounded repair pass is allowed to
  decide.
- `prompts/general_spec.md` — the ECB format, including how a marker attaches to
  the line or segment below it.
