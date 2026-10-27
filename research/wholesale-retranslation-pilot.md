# PILOT: wholesale-retranslation recipe, validated on `songs/drowning_sorrows.ecb`

Note on the filename: this file is written to the path the run configured, and that path says
"legend". The steering message moved the pilot off legend and onto `songs/drowning_sorrows.ecb`
(the most representative hard Mandarin case: 37 lines, 11 off, plus 4 malformed segments). Content
below is drowning_sorrows. The legend run I aborted is recorded at the end as a discarded
datapoint (its harness numbers are real and usable for budgeting).

Ticket: **tab-pinyinizer-i8v.4.6** (claimed from the queued per-song list under i8v.4; the
legend pilot ticket tab-pinyinizer-i8v.6 was closed as superseded, and its worktree/branch
were deleted unused — `songs/legend.ecb` was never edited).
Branch: **i8v46-drowning-retranslation**, worktree **/Users/longyuxi/workdir/tp-i8v46-drowning**,
commit **c9ce893**.

---

## 1. The recipe, copy-pasteable

`SONG` is the file stem. Two numbers have to be filled in for step 3 (`START` = first lyric
line, `END` = last line of the file); everything else is mechanical.

```bash
# ---- 0. claim + worktree + build -------------------------------------------------
# claim the queued per-song task first: bd list --parent tab-pinyinizer-i8v.4
cd /Users/longyuxi/workdir/tab-pinyinizer
SONG=drowning_sorrows
WT=../tp-${SONG}-retranslation
git worktree add "$WT" -b "retranslation-${SONG}"
cd "$WT"
ln -s /Users/longyuxi/workdir/tab-pinyinizer/node_modules node_modules
npm run build:cli                       # required: everything below runs from dist/

# baseline, for the record (copy the numbers onto the issue):
npm run audit-songs -- songs/$SONG.ecb

# ---- 1. extract the Chinese, one row per lyric line ------------------------------
# Do NOT use `npm run export-lyrics`: its output has bare `chinese`/`pinyin`/`english`
# header lines, and the harness parses a non-`#` non-`[section]` line as a LYRIC LINE,
# so the header words become lyric rows. Use this instead.
mkdir -p convert_workdir
SONG=$SONG python3 - <<'PY'
import os, re
song = os.environ["SONG"]
out, rows = [], []
for line in open(f"songs/{song}.ecb", encoding="utf-8").read().split("\n"):
    s = line.strip()
    if not s or s.startswith("%") or s.startswith(">"):
        continue
    m = re.fullmatch(r"<(.+)>", s)
    if m:                                    # ECB <Verse 1> -> harness [Verse 1]
        out.append(f"[{m.group(1)}]")
        continue
    if "[" not in s:
        continue
    texts = [mm.group(2).strip().split("|")[0].strip()
             for mm in re.finditer(r"\[([^\]]*)\]([^\[]*)", line) if mm.group(2).strip()]
    row = re.sub(r"[\s\u3000]+", "", " ".join(texts))   # ALL whitespace, as the matcher compares
    if row:
        out.append(row); rows.append(row)
open(f"convert_workdir/{song}_zh.txt", "w", encoding="utf-8").write("\n".join(out) + "\n")
print(f"{len(rows)} lyric lines, {sum(len(r) for r in rows)} Han characters")
PY
# Sanity gate before spending money: rows must equal the audit's "measuredLines", and each
# row's Han-character count must equal that line's `sung` count (romanization tokens) in
# `npm run audit-songs -- --json`. If they differ you have an extraction bug or a
# romanization mismatch, and the English will be matched to the wrong number.

# ---- 2. one whole-song translation pass ------------------------------------------
cd /Users/longyuxi/workdir/lyric-translator-tools     # FIREWORKS_API_KEY lives in its .env
uv run python -m harness.K_translate \
  "$OLDPWD/convert_workdir/${SONG}_zh.txt" --json \
  --out "$OLDPWD/convert_workdir/${SONG}_result.json"
# Read the `Match?` column of the table it prints. Every line must be ✅ (|diff| <= 1 is
# not enough — aim for exact, because the matcher places syllables per segment and an
# off-by-one line turns into an off-by-one SEGMENT somewhere).

# ---- 3. build the ecb-syllable-matcher input, dry-run it --------------------------
cd "$WT"
START=10   # first lyric line in songs/$SONG.ecb
END=58     # last line of the file
SONG=$SONG START=$START END=$END python3 - <<'PY'
import json, os
song, start, end = os.environ["SONG"], int(os.environ["START"]), int(os.environ["END"])
r = json.load(open(f"convert_workdir/{song}_result.json"))
rows = [{"originalChinese": l["zh"], "translatedText": l["en"]} for l in r["per_line"]]
inp = {"ecbFilePath": f"songs/{song}.ecb", "startLine": start, "endLine": end,
       "chineseLanguageIndex": 0, "debug": True, "rows": rows}
json.dump(inp, open(f"convert_workdir/{song}_matcher_input.json", "w"), ensure_ascii=False, indent=2)
print(len(rows), "rows")
PY
node dist/ecb-syllable-matcher.js convert_workdir/${SONG}_matcher_input.json \
  > convert_workdir/${SONG}_segments.json 2> convert_workdir/${SONG}_debug.txt
python3 -c "
import json; o=json.load(open('convert_workdir/${SONG}_segments.json'))
print('warnings:', o['warnings']); print('segments:', len(o['segments']))"
# A non-empty warnings array means a row ran out of syllables for a sub-chunk: shorten the
# translation for that line (re-ask the harness / re-run) - do not patch by hand.
# A character-mismatch exit means START/END is wrong for the block you extracted. Fix the
# range (or re-extract); that is your bug, not the script's.

# ---- 4. preview every line before touching the file ------------------------------
# Prints "--- N OLD / +++ N NEW" and writes convert_workdir/<song>_new.ecb. Diffing that
# against songs/<song>.ecb is exactly the positional check you want, and the OLD/NEW pairs
# are the text to paste into your Edit call.
SONG=$SONG python3 - <<'PY'
import json, os, re
song = os.environ["SONG"]
segs = json.load(open(f"convert_workdir/{song}_segments.json"))["segments"]
byline = {}
for s in segs: byline.setdefault(s["lineNumber"], []).append(s)
lines = open(f"songs/{song}.ecb", encoding="utf-8").read().split("\n")
out = []
for idx, line in enumerate(lines, start=1):
    if idx not in byline:
        out.append(line); continue
    pieces = [(m.group(1), m.group(2)) for m in re.finditer(r"\[([^\]]*)\]([^\[]*)", line)]
    new_segs = {s["segmentIndex"]: s["newText"] for s in byline[idx]}
    new_line = line[:line.index("[")].rstrip()
    for i, (chord, text) in enumerate(pieces):
        fields = [f.strip() for f in text.split("|")] if text.strip() else []
        if i in new_segs:
            fields = fields[:2] + [new_segs[i]]   # overwrite slot 3, or append it (W6 / W12)
                                                  # NOTE: drops any 4th+ field — none exist in this catalog
        new_line += f"[{chord}]" + "|".join(fields) + (" " if i < len(pieces) - 1 else "")
    out.append(new_line.rstrip())
open(f"convert_workdir/{song}_new.ecb", "w", encoding="utf-8").write("\n".join(out) + "\n")
for i, (o, n) in enumerate(zip(lines, out), start=1):
    if o != n:
        print(f"--- {i} OLD: {o}\n+++ {i} NEW: {n}")
PY
git diff --no-index --stat songs/$SONG.ecb convert_workdir/${SONG}_new.ecb

# ---- 5. apply with the Edit tool, then verify ------------------------------------
# Apply per contiguous block of lyric lines (NOT per single line - see wrinkle W5:
# repeated stanzas make a single line's oldText non-unique). Then:
npm run build:cli && npm run audit-songs -- songs/$SONG.ecb
# must show no line-syllable-mismatch, no segment-syllable-mismatch, no bad-field-count,
# no empty-track. (no-timestamps stays: i8v.3 owns it.)
node dist/timestamps/check.js songs/$SONG.ecb        # 0 errors expected when markers == 0

# positional proof: chords, Chinese and romanization byte-identical, only track 3 differs,
# and every non-empty segment has exactly %%languages fields, none empty:
SONG=$SONG python3 - <<'PY'
import os, re, subprocess
song = os.environ["SONG"]; path = f"songs/{song}.ecb"
def load(text):
    out = {}
    for i, line in enumerate(text.split("\n"), 1):
        if line.startswith("%") or not line.strip() or re.fullmatch(r"<.+>", line.strip()) or "[" not in line:
            continue
        out[i] = [(m.group(1), [f.strip() for f in m.group(2).split("|")] if m.group(2).strip() else [])
                  for m in re.finditer(r"\[([^\]]*)\]([^\[]*)", line)]
    return out
old = load(subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True).stdout)
new = load(open(path, encoding="utf-8").read())
assert old.keys() == new.keys(), "lyric line set changed"
bad = []
for ln in old:
    assert len(old[ln]) == len(new[ln]), (ln, "segment count changed")
    for k, ((co, fo), (cn, fn)) in enumerate(zip(old[ln], new[ln])):
        if co != cn or fo[:2] != fn[:2]: bad.append((ln, k, "chord/chinese/pinyin changed"))
        if len(fn) != 3 or any(f == "" for f in fn): bad.append((ln, k, fn))
print("non-English changes / bad field counts:", bad)
print("lines changed:", [ln for ln in old if old[ln] != new[ln]])
PY

# ---- 6. commit + hand off (do NOT merge, do NOT push) ----------------------------
git add songs/$SONG.ecb
git commit -m "Redo the English translation of ${SONG}.ecb syllable-matched via the harness (wholesale)"
bd -C /Users/longyuxi/workdir/tab-pinyinizer update <id> \
  --add-label needs-merge --append-notes "Wholesale retranslation on branch retranslation-${SONG}
  (worktree $WT), commit <sha>. Provenance: machine-drafted by harness K_translate
  (configs/best.json: A_v3 / qwen3p8-2p4t-a95b) and placement-checked by ecb-syllable-matcher;
  not human-written prose. Pilot cost/wall: ... Human review: read the diff, accept or reject
  the wording."
```

## 2. Cost and wall time (this is what the wave should budget)

| step | drowning_sorrows (37 lines, 360 Han chars) | legend (aborted, 20 lines) |
| --- | --- | --- |
| harness `K_translate`, attempt 1 | **$0.2631**, **169 s** wall | $0.2195, 163 s |
| harness attempts used | 1 (no retry) | 1 |
| `ecb-syllable-matcher` (37 `uv run C_cli.py` subprocesses) | **11.4 s**, deterministic (byte-identical re-run) | ~6 s |
| `npm run build:cli` + audit | seconds | seconds |

Budget **≈ $0.25–0.30 and ≈ 3 minutes per song** at this line count. The 13-syllable chorus
lines and the repeated stanzas do not make it cheaper per line (cost is dominated by the
counting-tool round trips the model makes), so scale linearly: `~/workdir/lyric-translator-tools`'s
own `configs/best.json` evidence says $0.117/song on its 10-song dev split, i.e. **raw lyrics run
~2x its measured average** — budget $0.30/song and you will not be surprised. Nine songs
≈ $2.50–3 and ≈ 25–30 min of wall clock total, so the whole wave is cheap; nobody needs to
serialize on cost.

## 3. Iterations needed: **zero**

- harness: 37/37 lines **exact** (`exact_pct: 100`, `max_abs_diff: 0`, `line_count_ok: true`,
  `extra_lines: []`) on the first attempt, seed 0, default config from `configs/best.json`
  (`A_v3` / `qwen3p8-2p4t-a95b`). No fit-check round, no re-ask, no line resisted.
- matcher: `warnings: []` — every row had enough syllables for every sub-chunk.
- audit after placement: 11 line mismatches → **0**, 0 segment mismatches.

The pilot therefore does **not** prove the iteration loop, because it was never needed. What it
does prove: at this size the harness lands on 100% exact on the first pass, so a worker should
expect the happy path and treat any `Match?` ⚠️ as unusual rather than routine.

## 4. Wrinkles the next 8 workers will trip on

**W1 — `npm run export-lyrics` is NOT harness-ready.** It writes three blocks with bare
`chinese` / `pinyin` / `english` header lines. `harness.AC_songs.parse_song` treats any line
that is not blank, not `#...`, not `[section]` as a lyric line — so the word `chinese` becomes
lyric row 1 and every count after it is off by one. Use the step-1 extraction snippet.

**W2 — `K_translate` has no `--fit-check-rounds` flag.** The README mentions fit-check rounds
under the *critic→reviser* pipeline (`DE_pipeline_critic`, `DB_run_matrix`), and
`--fit-check-rounds` is also absent from `K_translate`'s argparse. The only way to get
enforcement on ad-hoc lyrics is through the Python API, where `translate()` forwards
`**pipeline_kw` to `run_pipeline_a`:

```bash
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python - <<'PY'
from harness.K_translate import parse_lyrics, load_config, translate, render
text = open("/path/to/convert_workdir/<song>_zh.txt", encoding="utf-8").read()
song = parse_lyrics(text)
res = translate(song, load_config(), fit_check_rounds=2)   # <- real enforcement
print(render(res)); print(res["cost_usd"], res["wall_s"])
PY
```
`K_translate`'s own retry (2 attempts) fires only when an *attempt fails* (stuck / timeout /
malformed / budget / API error), never for an off-by-one line. Keep the plain CLI form as the
recipe; reach for the snippet only when the table has ⚠️ lines.

**W3 — strip ALL whitespace when building rows, not just the ends.** ECB Chinese carries
internal spaces from line wrapping (`[Emadd9]当你走进 这|...`, `南北的路从此 不再`, `一杯敬故乡 一`)
and the matcher compares with `[\s\u3000]+` removed from both sides. Joining segments with a
space and leaving it in is harmless to the harness but pointless noise in the prompt; stripping
is what makes `rows` byte-identical to the file. Concatenation order is left-to-right over
segments — do not reorder by chord.

**W4 — target-count mismatch between the two tools is silent.** The harness counts **Han
characters** (`count_syllables` "zh") and the matcher's per-segment target is **Han characters**
too, but `npm run audit-songs` counts **romanization tokens**. They agree on this file exactly,
which is why 100% harness fit became 0 audit mismatches. If a file shows
`romanization-mismatch` warnings, the two disagree and a green harness can still produce a red
audit. Gate before spending money: per line, `audit sung == len(row)`. (`drowning_sorrows` has
harmless pinyin typos — `su oi` for 所以, `bei tan mo` for 被淹没 — that never change token
counts. **Do not "fix" pinyin**: not your file's task, and it would be an unreviewed change.)

**W5 — single lines are not unique, so apply in blocks.** This file repeats whole stanzas; six
line pairs are byte-identical (`L23/L41`, `L24/L42`, `L25/L43`, `L26/L44`, `L27/L45`,
`L17/L35`). A per-line Edit with `oldText` = one line fails or hits the wrong copy. Replace
contiguous runs (I used 5 edits: L10–17, L20–27, L32–35, L38–45, L50–58). Their new text
happened to be identical in each pair because the Chinese is identical — but don't rely on it
in other songs; take the NEW text per line from `_segments.json`.

**W6 — the malformed segments are the step the wave must not miss.** `drowning_sorrows` had 4
segments with only 2 fields (`无处|wu chu ` on L27/L45/L57/L58). The matcher *does* emit text for
them (it indexes segments, not fields), but the file still needs the third field **appended**,
keeping the single space before the next `[chord]`:

```
- [Amadd9]灵魂不再|ling hun bu zai|My soul is now at [B7]无处|wu chu [Emadd9]安放|an fang|peace at last
+ [Amadd9]灵魂不再|ling hun bu zai|My soul now has [B7]无处|wu chu|somewhere [Emadd9]安放|an fang|to rest
```
`bad-field-count` does **not** block the matcher (it only reads the Chinese slot) and it does
not show up in the `warnings` array — a worker who only reads `warnings: []` will ship a file
that still fails `bad-field-count`. Always re-run the audit.

**W7 — expect mid-word hyphen splits at chord seams, and expect more of them than the old
text had.** 9 English segments in the new drowning_sorrows end in a hyphen: `Nobody re-` /
`members`, `drowning un-` / `der`, `soft-` / `ens`, `dance, ex-` / `hausted`, `tomor-` / `row`,
`we al-` / `ways`, `most ab-` / `surd` (×2). The matcher cuts at a syllable count and cannot see
the model's commas, so a chunk boundary can land inside a word. It is legitimate (the catalog's
own `condensed_blue_whale`/`translation_spec` example does `wait-`/`ing`), and it is the price
of exact segment fit. Do not hand-edit them away — that reintroduces a segment mismatch.

**W8 — section markers.** ECB `<Verse 1>` has to be handed to the harness as `[Verse 1]`;
empty sections (`<Introduction>` with no lyrics) are dropped by the parser, which is fine. The
`per_line` index is 0-based over lyric lines only, so `rows` order == file order regardless of
how many section markers you pass.

**W9 — traditional vs simplified: the matcher does zero normalization.** This file is fully
simplified so this pilot did not exercise it, but the matcher fails loudly on a
character-position diff if the harness echoes back traditional forms (it happens: the model
sometimes answers `發現` for `发现`). If `validateAlignment` fails at a position where the two
sides "look the same", that is the cause — fix the `rows` text, not the range. Same for a
stray full-width space or a Kangxi radical codepoint in the source (i8v.5's problem).

**W10 — punctuation is carried, not stripped.** The model emits `,` `'` `-` and the matcher
keeps them (`Dawn,` stays `Dawn,`; `you're` stays `you're`). Never post-process the output for
punctuation: the syllable counts were computed on those exact strings.

**W11 — Cantonese (`king_of_karaoke_cantonese`) is the odd one out.** The harness is
Mandarin-oriented (`count_syllables(language="zh")` = Han characters), which is still the right
target whenever one Han character is one sung syllable — which is what the `jyutping` column
should be. But if that file's jyutping has extra tokens per character, W4 bites. Check the
`romanization-mismatch` findings on that file before running the harness.

**W12 — five of the nine songs have no English column at all, and four have no `english`
DECLARED either.** The matcher only *reads* the file: it never edits `%%languages`, and it
assumes the field order already matches. Checked against HEAD:

| song | `%%languages` today | what the worker must add |
| --- | --- | --- |
| `if_love_has_a_destiny` | `chinese, pinyin` | add `english` to the header, then **append** a 3rd field to every segment (skill step 4, "new column") |
| `august_photo_booth`, `fleeting_time`, `rice_shop`, `rising_moon` | `chinese` | pinyin track first (the `add-pinyin-to-ecb` skill / pinyin-pro, one token per Han char, no tone marks), **then** `english` — two appended fields per segment |
| `when_you_are_old` | `chinese, pinyin, english` | 6 segments have an empty English field: append *inside* the existing column, same handling as W6 |

For the append cases (`fields.length < 3`) the step-4 preview snippet already appends; for the
`chinese`-only files it must append twice, and the pinyin column has to exist before you can
audit anything (`wrong-track-layout` until then). Extend the snippet deliberately rather than
trusting it as written.

## 5. Final audit line, and is the new English better?

```
file                  type      languages               markers  syllable fit  findings
--------------------  --------  ----------------------  -------  ------------  -------------
drowning_sorrows.ecb  mandarin  chinese,pinyin,english  0/37     37ok/0off     no-timestamps
```
Before: `26ok/11off`, `bad-field-count` (L27,45,57,58), `empty-track` (same 4),
`line-syllable-mismatch` (L16,22,25,26,40,43,44,51,52,53,56). After: only `no-timestamps`
(→ i8v.3). `node dist/timestamps/check.js` → `0 errors, 0 warnings, markers: 0`.

**Quality judgement (the thing the `human` label exists for).** Plainly: **a wash, leaning
"more faithful but uglier".** Better than the old text:

- `寒窗` → "the cold window" (old had "softening my cold youth" — a mistranslation);
- `山高水长` → "mountains high, rivers long" (old: "tales of endless mountain streams", invented);
- `人生苦短何必念念不忘` → "Life is short and bitter, why remember" (old: "Life is too short to
  hold on to the things so long" — clumsy);
- `各色的脸上各色的妆` → "Each face wears its own shade of makeup" (old compressed it to
  "Masked faces that you paint with care");
- `听他被淹没` → "You hear him drowning" (old had "them", the original is singular 他).

Worse than the old text:

- mid-word hyphen splits (W7), 9 of them, incl. `tomor-`/`row` and `most ab-`/`surd` — the old
  phrasing split cleanly at commas. This is the most visible cosmetic regression, and the
  reason a human, not the auditor, has to sign off;
- `南北的路从此不再漫长` → "The roads to north and south lose all their length" (old: "Now all the
  paths are not so long as they had been") — the new one is strained;
- `背上所有的梦与想` → "All your dreams are strapped to your back" (old: "With all of your old
  dreams and hopes") — "strapped" is a shade melodramatic;
- the two-line lockstep `于是`/`所以` ("and so") is now literal, which reads slightly clunky
  across the line break.

Net: I would **accept** it — the faithfulness gains are in the places the old text was actually
wrong, and no line lost an image — but I would tell a human to eyeball `L26/L44` and the
`tomor-`/`row` split first, and I'd expect a rejection to come back as "re-run the harness",
not as a hand patch.

## 6. Provenance and handoff state

- Provenance to record on every wave commit: English is **machine-drafted** by
  `lyric-translator-tools`' harness (`harness.K_translate`, config from that repo's
  `configs/best.json`: prompt `A_v3`, model `qwen3p8-2p4t-a95b`) and **placement-checked** by
  `src/ecb-syllable-matcher.ts`; it is not human-written prose.
- Harness run artifacts live in `~/workdir/lyric-translator-tools/runs/20261027-110356_adhoc-3784d674_A_v3_qwen3p8-2p4t-a95b_s0_f767/`
  (`adhoc` split, ignored by that repo's leaderboards). Nothing was committed or modified in
  that repo.
- Branch `i8v46-drowning-retranslation`, worktree `/Users/longyuxi/workdir/tp-i8v46-drowning`,
  commit `c9ce893`, issue `tab-pinyinizer-i8v.4.6` (labels: `needs-merge`, `human`,
  `needs-retranslation`, status `in_progress`). Nothing pushed, nothing merged. Index is clean;
  the only untracked entry in the worktree is the `node_modules` symlink the recipe creates
  (`git status --short` → `?? node_modules`) — expected for every worktree in this repo, and
  `convert_workdir/` is gitignored so the scratch inputs/`_new.ecb` never show up.

## Appendix — the discarded legend pilot (numbers only)

Killed by the mid-run steering, no edits made, branch + worktree deleted. Recorded because the
measurements are real:

- `songs/legend.ecb` measured now: `19ok/1off`; the only line mismatch is **L28**
  `发现 我一直` = 5 sung vs "to be found. I have been right" = 7 (+2), and **L25** is +1 at the
  line level but within the ±2 segment tolerance (`有约 今生的` 5 vs "life vow Our love sto-" 6,
  `[Am]` seam). Net excess syllables across the file = +3, consistent with the "found belongs
  to L27's 发现" reading: L27 `宁愿用这一生等你` = 8 vs "I'd rather spend my life waiting" = 8 is
  exactly full, so the fix is to end L27 with `found` and shorten L28 by the same 2.
- The harness pass I did run before stopping: 20 lines, **100% exact on the first attempt**,
  $0.2195, 163 s. The wholesale replacement it produced is in this report's history only —
  it was never applied to the file and the run is left in the tools repo's `runs/`.
