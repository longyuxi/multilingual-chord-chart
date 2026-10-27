# Timestamp coverage experiment: "most lines timed" → "every line timed"

Issue: `tab-pinyinizer-i8v.3.1` (parent `tab-pinyinizer-i8v.3`).
Worktree: `../tp-i8v3-coverage`, branch `i8v3-coverage`, from `31025b0` (merged pilot).
Commit: `47f3f27 Re-time mercury_records, fathers_prose_poem, wind_over_the_wheat_field with ElevenLabs`.

## Headline

**ElevenLabs forced alignment works, and it reaches every-line coverage on all
three songs with no `--repair` at all**: 62/62, 67/67, 26/26, all 0 errors from
`check-timestamps`, all `PASS` in `npm run audit-songs`.

**`--repair` makes coverage worse, not better.** It is net-negative by
construction once the aligner has already anchored every line: it may only move
a line or drop it, so the only reachable effect on coverage is a loss — and on
these three songs it dropped two genuinely sung lines, putting two files back
under 100%.

**The pilot's "whole-second collisions" are not a property of whole-second
resolution — they were a whisper-1 alignment failure.** Under ElevenLabs all
three songs have zero colliding starts (min start gap 0.48 s / 0.78 s / 1.34 s;
median ~3.4–3.7 s). The 5 collisions whisper produced on `mercury_records` are
four lines stacked on the *identical* start `29.98 s` with 0.00 s spans — no
emitter could mark those, but no correct aligner produces them either.

**On accuracy the two providers are not far apart, and ElevenLabs is not
better.** Against the 8 hand-made `condensed_blue_whale` markers (the only
ground truth in the repo) ElevenLabs lands 5/8 within 1.5 s, whisper-1 lands
6/8 — both late by a consistent +1..+2 s. ElevenLabs buys *coverage and
stability*, not measurably better onsets.

## 1. Per-song coverage table

`--density every-line`. "unanchored" and "same-second collisions" are read from
the aligner's own `AlignReport` (script: align the normalized lyrics against
every cached ASR stream and count `start == null` and `floor(start) == floor(prev
start)`), not eyeballed. Pilot rows are the merged state at `31025b0`.

| song | provider / flags | markers / lyric lines | unanchored | same-second collisions | check-timestamps | audit | wall | spend |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mercury_records | whisper-1 (pilot) | **54/62** | 3 | 5 | 0 err / 11 warn | **FAIL** partial-timestamps | — | already paid |
| mercury_records | elevenlabs, no repair | **62/62** | 0 | 0 | 0 err / 14 warn | **PASS** | 1.9 s | $0.0194 |
| mercury_records | elevenlabs + `--repair` | 62/62 (13 moved, 0 dropped) | 0 | 0 | 0 err / 17 warn | PASS | 6.0 s | +$0.0006 |
| fathers_prose_poem | whisper-1 (pilot) | **66/67** | 0 | 1 | 0 err / 10 warn | **FAIL** partial-timestamps | — | already paid |
| fathers_prose_poem | elevenlabs, no repair | **67/67** | 0 | 0 | 0 err / 12 warn | **PASS** | 1.8 s | $0.0204 |
| fathers_prose_poem | elevenlabs + `--repair` | **66/67** (13 moved, **1 dropped**: `[Am]止`) | 1 | 0 | not re-run (66 < 67 ⇒ partial) | **FAIL again** | 4.5 s | +$0.0006 |
| wind_over_the_wheat_field | whisper-1 (pilot) | **24/26** | 2 | 0 | 0 err / 6 warn | **FAIL** partial-timestamps | — | already paid |
| wind_over_the_wheat_field | elevenlabs, no repair | **26/26** | 0 | 0 | 0 err / 7 warn | **PASS** | 1.4 s | $0.0150 |
| wind_over_the_wheat_field | elevenlabs + `--repair` | **25/26** (7 moved, **1 dropped**: the `@4:05` hum line) | 1 | 0 | — | **FAIL again** | 2.7 s | +$0.0004 |

Shipped artifact = the **elevenlabs, no repair** rows. Wall time is the `time`
around `npm run timestamps` with the audio already cached (no download, no
yt-dlp). Spend is `duration / 3600 × US$0.22` for ElevenLabs and
`flagged lines × 200 in / 20 out tokens @ $0.15 / $0.60 per Mtok` for repair —
the same model `--dry-run` uses; the CLI's own dry-run report for the three
songs together prints `14:58 (898.2s) of audio: asr $0.0549 + llm repair $0.0065`.

**Total spend for the whole experiment: ≈ US$0.073** (4 ElevenLabs calls:
898.2 s for the three songs + 276.65 s for the `condensed_blue_whale` accuracy
probe = $0.0718; 3 repair calls over 35 flagged lines = $0.0015).

Every row above accounts exactly: emit is `anchored − same-second collisions`,
and that reproduces the pilot's numbers to the marker
(mercury 62−3−5 = 54, fathers 67−0−1 = 66, wind 26−2−0 = 24).

## 2. The ElevenLabs verdict

**Did the never-tested primary work? Yes.** No `HTTP 401 missing_permissions`,
no `missing_permissions` scope error: `POST /v1/forced-alignment` returned a
payload (`characters`, `words`, `loss`) in ~1.4–1.9 s per song. The key now has
the `forced_alignment` scope that `docs/timestamp-pipeline.md` records as
missing; that section is now stale and should be rewritten around this result.

Working audio (all cached, `ffprobe`):
`ENKFTmJxBaY` 318.08 s, `kVWYfY8pDGA` 334.04 s, `4NAXUmG5fwA` 246.05 s,
`t-m6CzYu3go` 276.65 s.

### Is it better or worse than whisper-1 on this Chinese material?

**Better on coverage and stability, roughly equal on onset accuracy, and worse
at telling you when it is guessing.** Three separate measurements:

**(a) Coverage / structural failures — ElevenLabs clearly better.**

- mercury_records: whisper 3 unanchored + 5 collisions vs ElevenLabs 0 + 0.
- fathers_prose_poem: whisper 0 + 1 vs 0 + 0.
- wind_over_the_wheat_field: whisper 2 unanchored + 0 vs 0 + 0.

**(b) The verse-1 collapse the pilot saw under whisper is gone.**
`mercury_records`, verse 1 (line starts, seconds):

| lyric line | whisper-1 | elevenlabs |
| --- | --- | --- |
| 着迷于你眼睛 | `null` (confidence 0.00, unanchored) | 16.56 |
| 银河有迹可循 | 28.58 (conf 0.25) | 20.34 |
| 穿过时间的缝 | 29.98 (conf 0.08, span 0.00 s) | 23.90 |
| 隙 它依然真实 | 29.98 (conf 0.08, span −0.00 s) | 26.16 |
| 地 吸引我轨迹 | 29.98 (conf 0.08, span −0.00 s) | 29.86 |

The same pathology restarts the next verse: whisper's 这瞬眼的光景 starts at
29.98 and absorbs a **29.86 s** span (29.98 → 59.84), then three more lines land
on 59.84 / 59.88 / 59.90 with 0.04 / 0.02 / 0.02 s spans. So it is 4 lines on
29.98 (not just the 4 the pilot counted in verse 1 — one of them is verse 2's
opener) and 3 more inside 60 ms at ~59.9 s. ElevenLabs gives the same verse a
uniform 1.8–2.8 s per line, confidence 1.00 throughout.

Cross-check per line where both anchored (`mercury_records`, 59/62 lines anchored
by both): median ElevenLabs−whisper = **+0.20 s**, 47/59 within 1 s, 51/59 within
2 s — and **every** disagreement larger than 2 s is inside those two collapsed
regions (lines 1,2,3,5,6,7,8, deltas −3.8 to −18.2 s). Outside the collapse the
two providers agree to a fraction of a second, i.e. whisper's problem is local
DP failure in a low-evidence passage, not a global offset.

**(c) Accuracy against the 8 hand markers — ElevenLabs slightly worse.**
I bought one ElevenLabs alignment of `condensed_blue_whale` (276.65 s, $0.0169)
and ran it on a **copy** (`convert_workdir/cbs-probe.ecb`); `songs/` was not
touched. Matched per lyric line against `d0a87ee:songs/condensed_blue_whale.ecb`
(the same comparison `npm run golden-timestamps` makes):

| hand | elevenlabs | delta | verdict |
| --- | --- | --- | --- |
| @0:40 | @0:42 | +2.0 s | MISS |
| @0:54 | @0:56 | +2.0 s | MISS |
| @1:10 | @1:11 | +1.0 s | ok |
| @1:23 | @1:25 | +2.0 s | MISS |
| @1:37 | @1:38 | +1.0 s | ok |
| @1:52 (segment-anchored) | @1:53 | +1.0 s | ok |
| @2:06 | @2:05 | −1.0 s | ok |
| @2:20 | @2:21 | +1.0 s | ok |

**5 of 8 within 1.5 s** vs whisper's documented **6 of 8**; mean |delta| 1.375 s
(ElevenLabs) vs 1.125 s (whisper). ElevenLabs is *more consistent* (all deltas
within −1..+2 s, no +3 s outlier) but not closer to the hand markers. Two
caveats: 8 markers is a tiny sample, and both providers are late by the same
sign — that smells like a shared systematic (token-onset definition, mp3
encorder delay, or where the human placed the hand marker) rather than a
provider difference. `--pad-start -1` is the existing knob for it; **I did not
tune it** (the skill forbids tuning the pipeline to fit a fixture), but this is
the single cheapest thing to test in the viewer next.

**(d) The important caveat: ElevenLabs cannot tell you when it is guessing.**
Forced alignment returns tokens for the text you supplied, so the aligner's
match fraction is ~100 % by construction:

| song | whisper-1 confidence < 0.6 / == 1.0 | elevenlabs |
| --- | --- | --- |
| mercury_records | 12 / 40 of 62 | **0 / 62 of 62** |
| fathers_prose_poem | 3 / 42 of 67 | **0 / 67 of 67** |
| wind_over_the_wheat_field | 8 / 16 of 26 | **0 / 26 of 26** |

`low-confidence` and `unanchored` therefore **cannot fire** on an ElevenLabs
alignment, and only the syllables-per-second bounds remain as flags. On
`wind_over_the_wheat_field` this matters concretely: whisper raises
`repeat-suspected` twice and leaves 2 lines unanchored, which is the honest
signal that the file under-lists the arrangement; ElevenLabs raises neither and
instead force-fits the surplus lines into the repeats. **Coverage from
ElevenLabs is real, but "0 unanchored" from ElevenLabs is not evidence that
every marker is right.** That is the case for keeping whisper-1 as a
corroborating second opinion rather than dropping it.

## 3. Classification of every line still unmarked (step 2d)

After the ElevenLabs runs, **zero lines lack a marker**, so this classifies the
11 whisper-1 residuals — the exact lines that made the pilot fail, and the
evidence for the every-line rule.

Line numbers are the aligner's `lineIndex` (0-based index into the `.ecb` source
lines, so file line = value + 1).

| song | `lineIndex` | lyric | class | aligner's own numbers |
| --- | --- | --- | --- | --- |
| mercury | 8 | 着迷于你眼睛 | unanchored | `start=null`, confidence 0.00 |
| mercury | 28 | 臂 做个梦给你 | unanchored | `start=null`, confidence 0.00 |
| mercury | 30 | 做个梦给 | unanchored | `start=null`, confidence 0.00 |
| mercury | 14 | 隙 它依然真实 | same-second collision with line 12 | both `start=29.98`, span 0.00 s, conf 0.08 |
| mercury | 16 | 地 吸引我轨迹 | same-second collision | `start=29.98`, span −0.00 s, conf 0.08 |
| mercury | 20 | 这瞬眼的光景 | same-second collision | `start=29.98`, span 29.86 s (!), conf 0.17 |
| mercury | 24 | 沿着你皮肤纹 | same-second collision with line 22 | `start=59.88` vs 59.84, span 0.02 s, conf 0.08 |
| mercury | 26 | 理 走过曲折手 | same-second collision with line 24 | `start=59.90`, span 0.02 s, conf 0.08 |
| fathers | 136 | 是那一辈人 留下 | same-second collision with its predecessor | `start=242.52` vs 242.04 — a 0.48 s gap that straddles a second boundary |
| wind | 54 | 嗯嗯 嗯 啦啦 | unanchored | `start=null`, conf 0.00 |
| wind | 56 | 啦啦 啦 | unanchored | `start=null`, conf 0.00 |

Separately, the `--repair` drop on fathers was **line 126 (`止`)**, which both
providers *did* anchor (whisper 230.14, ElevenLabs 229.58, with a matching `止`
token in the window the model was shown) — see section 6.

Totals: **5 unanchored + 6 colliding pairs = 11 = the 11 missing markers**
(8 + 1 + 2). Under ElevenLabs all 11 anchor with **0** collisions.

**What this decides for the every-line rule:**

1. Same-whole-second collisions are *not* a resolution limit on this material.
   Real line-to-line start gaps under ElevenLabs: min 1.34 s (mercury), 0.48 s
   (fathers, and it happens to floor into distinct seconds), 0.78 s (wind);
   p10 1.78 / 2.52 / 1.56 s; median 3.74 / 3.38 / 3.48 s. With 2–3 s of typical
   headroom, one whole-second marker per line is attainable. The only genuinely
   tight pair in 155 lines is fathers' 0.48 s one, and whether it collides is
   luck of the boundary — that is the *only* place an exception ("a sub-second
   line start may be left unmarked") would ever be needed on these songs, for
   1 line in 155 (0.6 %).
2. The 5 real collisions whisper produced were the *symptom* of the collapse,
   not a rounding problem: four lines with the identical start `29.98` and
   0.00 s spans, and one line holding a 29.86 s span. Fixing the provider
   removed both the collapse and the collisions.
3. So: **the every-line rule is attainable at whole-second resolution for these
   three songs, provided the primary provider is used.** The rule needs no
   exception for sub-second starts on this evidence; the risk is provider
   quality, not marker resolution.

## 4. Are wind's hum lines unanchorable in principle?

**Under whisper-1, yes — they are unanchorable, and that is a provider
limitation, not a pipeline defect.** Whisper's transcript of `4NAXUmG5fwA` has
**0 tokens** containing 嗯 or 啦 across the whole 246 s (247 tokens, none of them
vocalise), so the 8 hum lines have literally nothing to align against. Its
transcript at 40–70 s is `湿我眼眶` then `我们` — the entire vocalise passage is
silent to it.

**Under ElevenLabs they are markable, but only because ElevenLabs is told what
to place.** Its aligned character stream contains 36 嗯/啦 tokens spanning
42.2 s → 246.0 s, clustering at 40–70 s, 170–180 s, 210–220 s and 240–250 s.
Those clusters are where the singer vocalises; between them are 30–75 s of
unclaimed audio. The four tail hum lines therefore land at `@1:39`, `@2:55`,
`@3:39`, `@4:05` — each one inside a stretch where the *same* hum is performed
repeatedly, so the marker is a defensible choice, not a measurement. That is
also why `--repair` dropped the last one (`@4:05`, notes: "Line 60 is likely part
of a repeated section and should be dropped").

## 5. Wind_over_the_wheat_field has a real file problem (not a pipeline bug)

Whisper's independent transcript of `4NAXUmG5fwA` shows the verse pair performed
**twice**, the second time starting ~140 s:

```
  10- 40s  V1 lyrics        60-100s  V2 lyrics
 140-170s  V1 lyrics again 190-230s  V2 lyrics again
```

The `.ecb` lists V1 and V2 **once each**. So any monotonic aligner must pick one
performance: ElevenLabs picks the first (`@0:14`…`@1:10`, which matches what
whisper's *transcript* hears at 60–100 s), whisper's DP picks the second
(`@3:15`…`@3:40`) and drags the hum lines to `@1:10`/`@2:20`/`@2:26`/`@2:28` in
the process. ElevenLabs' choice is the coherent one, but **the marker set is
still only complete for one of the two performances** — the file needs the verse
pair listed twice (a content edit, `repeat-suspected` territory, the pipeline
will not and should not make it). This is the one place where the shipped
26/26 is "every listed line marked" rather than "the song is fully timed".

## 6. What looks like a bug rather than a limitation

1. **`--repair` will happily reduce coverage below the standard's bar, and
   nothing stops it.** `assertEmittable()` re-checks only monotonicity and
   range, so a patch whose only effect is `drop: true` on a sung line is written
   silently. On `fathers_prose_poem` it dropped `[Am]止` — a line **both**
   providers anchored, with a matching `止` token at 229.58 s in the window it
   was shown (ElevenLabs) and at 230.14 s (whisper). The model saw evidence and
   dropped anyway, and rule 6 of `prompts/fix_timestamps.md` ("the honest answer
   is either `drop: true` … or no entry at all") points it that way. For an
   every-line standard this is the wrong default: coverage should be at worst
   unchanged by a repair pass, e.g. refuse (or report loudly) a patch whose net
   effect is fewer markers. Not changed — that is a product decision for the
   parent.
2. **`--repair` is structurally useless once coverage is complete.** It can only
   move or drop, so on an all-anchored aligner output its best case is a ≤1 s
   move and its worst case is a hole. Measured: 35 flagged lines, 33 moves
   (only 12 of which changed a floored marker, all by exactly +1 s) and 2 drops.
   Verifier noise also rose (mercury 14 → 17 warnings). On this evidence the
   pilot recipe should be "`--provider elevenlabs`, no `--repair`", and
   `--repair` should be reserved for a provider that leaves lines unanchored.
3. **ElevenLabs' 1.00 confidence hides bad alignments** (section 2d). Not a bug
   in the adapter, but the `low-confidence`/`unanchored` flags silently stop
   being a quality signal when the primary provider is used, and the pipeline
   gives no indication of that. A cheap mitigation — not implemented — would be
   to flag a line whose span is 0.00 s or which sits inside a > 20 s token gap,
   both of which are visible in the report today (they are what the
   syllables-per-second-low warnings catch indirectly).
4. **`docs/timestamp-pipeline.md` is now wrong in three places**: the
   "ElevenLabs forced alignment is unverified in this repo" section (it works),
   the provider table's `adapter landed, not yet verified end-to-end` status, and
   the golden-gate note's claim that ElevenLabs "is expected to land closer to
   the hand markers" (measured: 5/8 vs whisper's 6/8). `npm run
   golden-timestamps` still reports 6 of 8 (NOT MET) — unchanged by this work,
   because the fixture is whisper-1 and `songs/condensed_blue_whale.ecb` was not
   touched. Docs not updated here to keep the diff markers-only.

Not a bug: `golden-timestamps` failing at 6/8, the `--stems` no-op notice, and
the 33 `check-timestamps` warnings (they are the syllables-per-second bounds
doing their job on short/long lines; 0 errors).

## 7. Verification of the shipped diff

```
$ git diff --stat
 songs/fathers_prose_poem.ecb        | 47 +++++++++++++-------------
 songs/mercury_records.ecb           | 46 ++++++++++++++--------------
 songs/wind_over_the_wheat_field.ecb | 32 ++++++++++------------
 3 files changed, 68 insertions(+), 57 deletions(-)
```

Markers-only proof: strip `^@[0-9]` lines from `HEAD:songs/<f>.ecb` and from the
new file and `diff` — identical for all three files (no lyric, chord, pinyin,
`english` or metadata line changed). `@M:SS` lines are the only added/removed
lines, and every marker sits on its own line directly above its lyric line.

```
$ npm run check-timestamps -- songs/mercury_records.ecb songs/fathers_prose_poem.ecb songs/wind_over_the_wheat_field.ecb
  markers: 62, sung lines: 62, un-anchored: 0
  markers: 67, sung lines: 67, un-anchored: 0
  markers: 26, sung lines: 26, un-anchored: 0
Checked 3 files: 0 errors, 33 warnings.

$ npm run audit-songs -- songs/mercury_records.ecb songs/fathers_prose_poem.ecb songs/wind_over_the_wheat_field.ecb
mercury_records.ecb            mandarin  chinese,pinyin,english  62/62    62ok/0off     PASS
fathers_prose_poem.ecb         mandarin  chinese,pinyin,english  67/67    67ok/0off     PASS
wind_over_the_wheat_field.ecb  mandarin  chinese,pinyin,english  26/26    26ok/0off     PASS
3 songs pass, 0 songs fail
```

Idempotent (second run, cached ASR, no write):
`already up to date (62 markers would be written)` ×3, `Summary: written 0,
unchanged 3`.

`npm run golden-timestamps`: 6 of 8 within 1.5 s, NOT MET — identical to the
documented pre-existing result; nothing here touches that song.

## 8. Blunt summary for the decision

- The standard's every-line rule **is attainable at whole-second resolution for
  these three songs** — 155/155 lines marked, 3/3 audit PASS — but only with
  `--provider elevenlabs`. With whisper-1 it is not: 11 lines (7 %) are lost to
  5 unanchored lines and 6 colliding starts.
- The collision half of that loss is **not** a resolution artefact and needs no
  exception in the standard. The unanchored half, and specifically wind's hum
  lines, is **provider-dependent**: unanchorable in principle from a transcript
  (whisper hears no vocalise at all), markable only by force-fitting text in the
  ElevenLabs sense, where the marker points into a repeated vocalise and is a
  choice rather than a measurement.
- Wind needs a *file* edit to be honestly complete (V1/V2 are performed twice
  and listed once). That, not marker resolution, is the real ceiling on "every
  line timed" for this song.
- Do not ship `--repair` with ElevenLabs: it cost 2 lines and gained nothing.
