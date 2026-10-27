# Cheapest reliable path to a syllable-matched English translation of a Cantonese song

Target: `tab-pinyinizer/songs/king_of_karaoke_cantonese.ecb` (K歌之王 粤语, Eason Chan).
Bar: `tab-pinyinizer/docs/song-standard.md` — line `|sung − translated| ≤ 1`, segment `≤ 2`,
sung = jyutping tokens, translated = `lyric-tools` CMU count via `C_cli.py`.

All numbers below were measured in this session (no paid API calls).

---

## 0. Ground truth I established first (measured, reproducible)

| Measurement | Value | How |
| --- | --- | --- |
| Lyric lines in the file | **30** (47 `[chord]` segments) | parse of the .ecb |
| Han characters (counted by `annotate_zh_line`) | **365** | `syllable_tools.A_syllables.annotate_zh_line` |
| Jyutping tokens (the standard's sung count) | **366** | token count of track 2 |
| Lines where Han-count ≠ jyutping-count | **1 of 30** — line 42 (`說 K歌之`, Latin `K` counts 0) — and there the gap is exactly 1 | line-by-line comparison |
| Uncounted non-space characters in the whole song | **exactly one: `K`** (line 42). Every traditional character (麼 U+9EBC, 淚 U+6DDA, 皺 U+76BA, 動 U+52D5, 願 U+9858, 銀 U+9280 …) falls inside `[\u4e00-\u9fff\u3400-\u4dbf]`. | zero-count scan over all 30 lines |
| Current translation vs the standard | **14/30 lines within ±1, 8/30 exact** — reproduces the audit's `14ok/16off` exactly | `C_cli.py --count` on the English track, compared with Han/jyutping counts |
| Current audit verdict | `line-syllable-mismatch`, `segment-syllable-mismatch`, `no-timestamps`; 0/30 lines carry `@M:SS` | `npm run audit-songs -- songs/king_of_karaoke_cantonese.ecb` |

**The single most important finding:** for *this* file the harness's Mandarin metric
("one syllable per Han character", `syllable_tools/A_syllables.py:138-154`,
`harness/E_fit.py:128-130`) is an almost exact stand-in for the standard's Cantonese metric
("one syllable per jyutping token"): 29/30 lines identical, the 30th off by 1 and therefore
still inside the ±1 line tolerance. The Cantonese lyric is written in Standard Written Chinese
(as essentially all Cantopop is), so counting characters is counting sung syllables.

That means the *counting* half of the pipeline is **not** blocked by Cantonese. What is
Mandarin-locked is the *prompt* and the *evidence base*, not the arithmetic.

---

## 1. Is `lyric-translator-tools` Mandarin-locked, and where?

Four distinct layers; only (a) and (c) matter in practice, and (c) matters most.

### (a) Prompt / user-facing wording that says "Mandarin" — cosmetic but not free

| Location | Text |
| --- | --- |
| `prompts/A_v3.md:25` (the config `configs/best.json` selects) | "Translate the **Mandarin** lyrics above … same number of syllables as its **Mandarin** line" |
| `prompts/A_v3.md:34` | "Call `count_syllables` once with all the **Mandarin** lines (language "zh")" |
| `prompts/A_v3.md:39` | "one string per **Mandarin** lyric line" |
| `prompts/A_v4.md:21`, `A_v5.md:21` | same sentence as A_v3 |
| `harness/K_translate.py:1` and `:278` | module docstring / `--help` description: "Translate arbitrary **Mandarin** lyrics" |
| `harness/E_fit.py:266,272,284` | table header literally `| # | Mandarin (syllables) | …` |
| `.claude/skills/translate-lyrics/SKILL.md:3,16,35,40` | skill description/instructions: "Mandarin/Chinese song lyrics", "Mandarin, one lyric line per line" |
| `harness/DD_fit_check.py:81` | fix-request text: "the required syllable count of their **Mandarin** line" |
| `harness/D_pipeline_a.py:70,79-80` | tool enum is `["zh","en"]`; alias map maps `mandarin`→`zh` but there is no `yue`/`cantonese` alias |

Consequence beyond cosmetics: nothing in the prompt tells the model the text is Cantonese, and
this song contains at least one Cantonese-only lexical item — **咪高峰** ("microphone"), split
across segments at line 41 (`[G]真心真意 咪|zan sam zan ji mai|…[F#m7-5]高峰…`). A Mandarin
reading gives 咪 ("meow/…") + 高峰 ("peak"); the current human English correctly says
"microphone". `grep` for other Cantonese-only particles/markers (唔 咗 喺 嘅 嗰 佢 冇 睇 諗 而家
屋企 攞 廿) returns **zero hits** — this lyric is otherwise plain SWC, so the lexical exposure is
narrow (one word) but real. The other exposure is register: A_v3's feel brief names "classical,
folk, modern colloquial" (Mandarin-songwriting genres); Cantopop's register is a different
target. Nothing about rhyme is requested either, which is a missed opportunity, not a lock.

### (b) Source-syllable counting — correct enough for Cantonese

`annotate_zh_line` (`syllable_tools/A_syllables.py:138-166`, range test at `:154`) counts
Han codepoints only: U+4E00–9FFF and U+3400–4DBF. Verified above: exactly one non-space
character in the whole song (`K`) is uncounted, worth −1 target on line 42 and inside tolerance.

Two honest caveats:
- Cantonese lyrics that use Latin letters in earnest (`K歌之王` is the mild case) or full-width
  digits would undercount. `E_fit.py:42` documents this ("any Latin letters count 0").
- The count is a *character* count, so it silently assumes 1 char = 1 sung syllable. For
  Cantonese that holds for this file; it would fail on a file with melisma-per-character or on
  romanization tokens that are not 1:1 with characters. Hoisting the target from the file's own
  jyutping column (as the audit does) would be strictly more correct — the harness has no such
  concept.

### (c) Data / split assumptions — the real gap, and it is not fixable by a config tweak

- `harness/AC_songs.py:26,46,51` — `parse_song` recognises `# key: value` headers and
  `[section]` markers. `%%title …` / `%%languages …` lines in an `.ecb` are **not** headers, so
  feeding a raw `.ecb` to `K_translate` makes `%%title K歌之王 (King of Karaoke) 粤语 (Cantonese)`
  a lyric line. The `.ecb` must be reduced to plain per-line Han text first (see §5).
- `data/songs/*.txt` (18 songs) and `data/splits.json` (`dev` 11 / `test` 7) are **100% Mandarin**
  and there is no `yue`/`cantonese` string anywhere in the source tree (grep over `*.py`, `*.md`,
  `*.json`, excluding `.venv`, returns nothing). So:
  - `configs/best.json`'s evidence ("dev 90% exact, test 100% exact, feel Elo 1875, $0.117/song,
    190 s/song") is measured on Mandarin only. Applying "the best config" to Cantonese is an
    extrapolation, not a result.
  - `harness/DB_run_matrix.py`, `harness/G_judge.py`, `harness/H_leaderboard.py` all select by
    split and therefore cannot evaluate a Cantonese prompt variant. Any prompt/rubric change is
    uncalibrated by construction.
  - `harness/DE_pipeline_critic.py:201` loads only `data/songs/<id>.txt` (`load_song`), so the
    critic→reviser pipeline cannot be pointed at an external `.ecb` without copying the lyrics
    into `data/songs/` (dataset pollution).
- `harness/E_fit.py:265-286` — the report table header says "Mandarin", and there is no segment
  concept at all: the harness scores whole lines only. Segment tolerance (`≤2`) is entirely
  delegated to `ecb-syllable-matcher` on the tab-pinyinizer side.

### (d) Traditional characters

Nothing in the repo converts, normalises or rejects script variants: no `NFC/NFKC` (except
`nfkc()` in the *audit*, `src/song-audit.ts:290`, used only for the Han-count fallback), no
`opencc`, no "simplified" string in the source tree. Traditional input is counted correctly
(verified). The prompt never says "simplified". So: **traditional input works**, and the harness
echoes the source lines back unchanged (`per_line[].zh` is the input line), which is exactly
what the placement script needs.

---

## 2. Does anything require simplified? Does the char-for-char placement constraint bind?

**No, and the constraint is a constraint on the *rows you feed the placer*, not on the pipeline
direction.**

- `src/ecb-syllable-matcher.ts:23-30` states it performs no traditional→simplified conversion
  and no fuzzy matching; `validateAlignment` (`:260-280`) fails with a char-position diff if the
  concatenated row Chinese ≠ the concatenated `.ecb` Chinese.
- `.claude/skills/add-syllable-matched-translation/SKILL.md:49-57` (step 2) tells the agent to
  convert the *table's* Chinese to the file's variant by hand.
- Because this `.ecb` is traditional and we build the rows **by copying the `.ecb`'s own Han
  text**, there is nothing to convert. Conversion would only become necessary if the translation
  source came from a simplified artefact.
- Practical trap found: the repo-root file `lyric-translator-tools/king_of_karaoke.txt` (an
  earlier hand-made input for this song) writes **米高峰** where the `.ecb` has **咪高峰**, and it
  re-segments the song into 29 lines instead of the `.ecb`'s 30 (total Han chars agree: 365).
  Using it verbatim would fail `validateAlignment` on the character and blur the per-line
  targets. Regenerate the input from the `.ecb` instead (one command, §5).

---

## 3. Options, ranked

Shared precondition for all options (cheap, do once):

```bash
cd /Users/longyuxi/workdir/tab-pinyinizer
npm run build:cli
# 30 lines of Han text, one per .ecb lyric line, chords/romanization/English stripped,
# leading text before the first [chord] KEPT (4 lines have it: 8, 10, 11, 29)
python3 - <<'EOF'
import re
src='songs/king_of_karaoke_cantonese.ecb'; out='/tmp/kk_zh.txt'; rows=[]
for l in open(src,encoding='utf-8').read().splitlines():
    if l.startswith('%') or not l.strip() or re.match(r'^<.+>$',l) or '[' not in l: continue
    items=[]
    lead=l[:l.index('[')].strip()
    if lead: items.append(lead.split('|'))
    items += [t.split('|') for _,t in re.findall(r'\[([^\]]*)\]([^\[]*)',l) if t.strip()]
    rows.append(''.join(t[0] for t in items))
open(out,'w',encoding='utf-8').write('\n'.join(rows)+'\n')
print(len(rows),'lines')
EOF
```

Sanity check of the input (must print 30 and 365):

```bash
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python -c "
from syllable_tools.A_syllables import annotate_zh_line
ls=[l.strip() for l in open('/tmp/kk_zh.txt',encoding='utf-8') if l.strip()]
print(len(ls), sum(annotate_zh_line(l)['total_syllables'] for l in ls))"
```

---

### Option A (recommended): reuse the harness as-is, one run, then place mechanically

Two sub-variants; A0 is the *cheapest thing that can possibly work*, A1 is the honest upgrade.

**A0 — no code, no prompt change, one paid call**

```bash
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python -m harness.K_translate /tmp/kk_zh.txt --json --out /tmp/kk_en.json
# same table, human-readable, if you prefer:
uv run python -m harness.K_translate /tmp/kk_zh.txt
```

- Files changed: **none**. Input file only.
- Cost / wall time: the harness has already run A_v3 + qwen3p8 on a 32-line adhoc song for
  **$0.1216 and 84 s** (`runs/20261023-003312_adhoc-a360e04a…/meta.json`); `configs/best.json`
  reports $0.117/song and 190 s/song on dev, $0.113 / 128 s on test; README says 1–5 min per
  run, "typical cost is a few cents". Budget **$0.10–0.25 and 1.5–4 min** for one run, and one
  retry is automatic (`K_translate.DEFAULT_ATTEMPTS = 2`) so worst case ≈ $0.5 / 8 min.
- Fidelity evidence for the target metric: exact-char counting is right for this file (§0), and
  A_v3 got 100% exact on the Mandarin songs in `data/songs` — but **exact% on Cantonese is
  unmeasured** (no Cantonese song in the dataset).
- Main risk: the prompt says "Mandarin" and the model may mistranslate the one Cantonese-lexicon
  word (咪高峰) and adopt a Mandarin-art-song register. Everything else (counts, fit enforcement
  by the scorer, line mapping) is deterministic and already correct.

**A1 — same command, one new prompt file (the smallest defensible change)**

Add `prompts/A_v6_yue.md` = A_v3 with (i) "Mandarin" → "Cantonese (粤语, sung in Cantonese, the
lyrics written in Standard Written Chinese)", (ii) an explicit note that the syllable target is
the number of *sung Cantonese syllables*, which for this text equals the Han-character count
(do not add or drop syllables for tone/particles), (iii) a short Cantonese-specific lexicon hint
(咪高峰 = microphone; 二十首 = the twenty songs; K歌之王 = King of Karaoke — do not translate the
letter K as a syllable), (iv) keep A_v3's "every line exact / count via tool / ≤5 rounds"
workflow verbatim.

```bash
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python -m harness.K_translate /tmp/kk_zh.txt --prompt A_v6_yue --json --out /tmp/kk_en.json
```

- Files changed: **one new prompt file** (`prompts/A_v6_yue.md`, ~40 lines, copy of A_v3 with
  front matter `version: A_v6_yue`, `pipeline: A`, `parent: A_v3`, `output_format: json`).
  Zero harness code (`DA_prompts.load_prompt` accepts any `prompts/<version>.md`;
  `K_translate --prompt` already exists). No `data/` or split change, so no leaderboard impact.
- Cost/time: identical to A0 (~$0.12, ~1.5–3 min).
- Main risk: **the Cantonese prompt is uncalibrated** — no Cantonese song exists in `data/`, so
  `DB_run_matrix`/`G_judge`/`H_leaderboard` cannot score it; any "this prompt is better" claim
  is a judgement call, not a measurement. Also A1 does not fix the metric asymmetry on line 42
  (target 11 vs sung 12); that stays a tolerated ±1.
- Optional 4-line harness improvement (not required): `harness/K_translate.py` never passes
  `fit_check_rounds` through, so the harness-enforced fix loop of `harness/DD_fit_check.py`
  (`run_pipeline_a(..., fit_check_rounds=N)`, `D_pipeline_a.py:209,251-260`) is unreachable from
  the CLI. Adding `--fit-check-rounds` (one `add_argument` + one kwarg in the `translate(...)`
  call, both in `K_translate.main`) converts A1 from "the model says it fit" into "the scorer
  forced it to fit", at roughly +$0.01–0.03 and +20–60 s. `translate()` already forwards
  `**pipeline_kw` to `run_pipeline_a`, so it really is ~4 lines plus a test.

**Placement after A0/A1** (both repos, deterministic):

```bash
cd /Users/longyuxi/workdir/tab-pinyinizer
# 1. build rows from the harness JSON (zh is the input line verbatim -> char-for-char safe)
python3 - <<'EOF'
import json
d=json.load(open('/tmp/kk_en.json'))
rows=[{"originalChinese":p["zh"],"translatedText":p["en"]} for p in d["per_line"]]
json.dump({"ecbFilePath":"songs/king_of_karaoke_cantonese.ecb","startLine":8,"endLine":47,
           "chineseLanguageIndex":0,"rows":rows},
          open('convert_workdir/kk_matcher.json','w'),ensure_ascii=False,indent=1)
EOF
# 2. place
node dist/ecb-syllable-matcher.js convert_workdir/kk_matcher.json > convert_workdir/kk_placed.json
# 3. apply the 47 segment texts by hand/Edit per the skill, then verify
npm run audit-songs -- songs/king_of_karaoke_cantonese.ecb
```

- `chineseLanguageIndex: 0` is already correct here (`%%languages chinese, jyutping, english`).
- Segment-level fit comes for free: the matcher hands each sub-chunk up to its Han-character
  target (`ecb-syllable-matcher.ts` docstring, "HOW SYLLABLES ARE DISTRIBUTED"), so a line-exact
  translation yields segment diffs of 0–1, well inside the `≤2` tolerance.

### Option B: no harness — agent drafts, `C_cli.py` counts, matcher places

```bash
# one batch call for the targets (Han chars per line, == sung syllables, see §0)
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python -c "
from syllable_tools.A_syllables import annotate_zh_line
for l in open('/tmp/kk_zh.txt',encoding='utf-8'):
    if l.strip(): print(annotate_zh_line(l.strip())['total_syllables'])"

# draft 30 lines in a file (one per line), then one batch count of the English
uv run syllable_tools/C_cli.py --count /tmp/kk_draft.txt
# or the MCP tool count_syllables(text, "en") if the agent has it wired
```

Loop: rewrite only the lines whose count ≠ target, re-`--count`, until 30/30. Then the same
`ecb-syllable-matcher` placement as above.

- Files changed: **none** (scratch files only). Note `C_cli.py` has no `--zh` mode; the zh
  target comes from the two-line `python -c` above, or from `syllable_tools/B_mcp.py` over MCP.
- Cost/time: **$0 in API spend**; wall time is agent latency — realistically 10–25 min for 30
  lines with 3–6 count rounds, plus a `uv run` startup per `--count` call (batch mode is one
  process, ~1 s).
- Quality risk: no second opinion and no judge; the counts will be perfect (`C_cli` is the same
  function the audit uses) but "is this a faithful, singable translation of a Cantonese song"
  rests entirely on one agent pass. Also nothing is recorded in `runs/` — no reproducibility,
  no diffable artefact.
- Where B wins: it is the only option that can read the whole .ecb with chords, segment
  boundaries and candidate rhyme in view, and it is the cheapest way to produce a *first* draft
  you then hand to A for a fit-hardened second opinion (that hybrid is what I would actually do
  if taste matters: B draft → A1 with the draft as a reference → matcher).

### Option C: critic→reviser pipeline (already in the repo) — available but not for external files

```bash
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python -m harness.DB_run_matrix --prompts A_v3 --models qwen3p8 --split dev --pipeline C --fit-check-rounds 2
uv run python -m harness.DE_pipeline_critic --song hao_jiu_bu_jian   # data/songs only
```

- Blocked for this task: `DE_pipeline_critic.py:201` and `DB_run_matrix` load via
  `AC_songs.load_song(id)` → `data/songs/<id>.txt`; there is no adhoc/in-memory path (unlike
  `run_pipeline_a(song=…)`, which `K_translate` uses). Using it means copying the lyric into
  `data/songs/` — dataset pollution for an unmeasured language.
- Cost/time if it were used: 3 model calls per song (draft + critic + reviser) plus up to 2
  enforced fit rounds — roughly 2.5–3× A ≈ **$0.3–0.5 and 4–8 min**.
- Verdict: real value (a critic pass on imagery/register is the one thing A0/A1 lack), wrong
  plumbing for an external `.ecb`. Cheaper route to the same effect: run A1, then have an agent
  review the 30 English lines against the Cantonese source and re-run only the bad lines
  (`--json`, then a 5-line input file for the rejects; a rejects-only run costs ~$0.02, ~40 s).

### Ranked

1. **A1** (A_v3 command + one new `prompts/A_v6_yue.md`) → then `ecb-syllable-matcher`. ~$0.12,
   2–3 min, one prompt file, no code. Best reliability per dollar, and the only variant with a
   chance of getting 咪高峰 and the Cantonese register right. Optional +4 lines in
   `K_translate.py` to expose `--fit-check-rounds` makes the fit enforced rather than claimed.
2. **A0** (identical command, existing `A_v3`) — zero-change fallback if a new prompt file is
   out of scope; expect ~90–100% exact fit on this file by construction of the metric, with the
   register/lexicon risk above.
3. **B** (agent draft + `C_cli --count` + matcher, no API) — $0, 10–25 min, perfect counts,
   unverified taste and no run record. Use as a draft generator in front of A1 if you care about
   imagery over provenance.
4. **C** — do not adopt for this task (needs `data/songs/` pollution); replicate its critic step
   with a rejects-only A1 re-run instead.

---

## 4. Does tab-pinyinizer need changes?

**Mostly no — the translation work lives entirely in `lyric-translator-tools`. One real latent
bug and one orthogonal blocker were found.**

| Item | Verdict | Evidence |
| --- | --- | --- |
| `src/ecb-syllable-matcher.ts` `chineseLanguageIndex` | **No change.** Default `0` is correct: `%%languages chinese, jyutping, english` puts the sung Han track first. | `ecb-syllable-matcher.ts:91,414`; the file's header |
| Its English syllable source | **No change.** It shells out to `uv run --directory <lyricToolsDir> syllable_tools/C_cli.py <text>` (single-line mode), i.e. the same `annotate_en_line` the audit batches. Language-agnostic. | `ecb-syllable-matcher.ts:281-295` |
| The audit's jyutping counting | **No change — and it is the authoritative side.** `sungSyllables` prefers the romanization column's token count and only falls back to Han chars when there is no romanization track; `ROMANIZATION_TRACKS = {'pinyin','jyutping'}`, `detectSongType` returns `cantonese` for `jyutping`, expected layout `['chinese','jyutping','english']`. | `src/song-audit.ts:60,297-305,339-353,435-440,489` |
| Requirement that the translation table's Chinese match the `.ecb` char-for-char | **Sets the direction, not an obstacle.** Rows must be built from the `.ecb`'s own (traditional) text; nothing needs simplifying. Watch the stray `米高峰` in `lyric-translator-tools/king_of_karaoke.txt`. | `ecb-syllable-matcher.ts:23-30,260-280`; skill step 2 (`:49-57`) |
| **Latent bug: leading text before the first `[chord]` is dropped by the audit and by `export-lyrics`** | **Needs a fix (2 files, small).** `SEGMENT_RE = /\[([^\]]*)\]([^\[]*)/g` cannot match the text before the first bracket, so for `.ecb` lines 8, 10, 11 and 29 (`我唱…`, `我只…`, `請…`, `我唱…`) roughly 1–2 Han chars and their English are invisible to `line-syllable-mismatch`. `ecb-syllable-matcher.ts:213-218` *does* handle that leading segment (it pushes a chordless segment), so the placer and the auditor disagree about what the line contains. Currently harmless (both sides lose the same 2 syllables: 我唱/"I sing", 我只/"I only", 請/"Please"), but any excess syllables placed at a line start would pass green. Fix = accept leading text as a chordless segment in `song-audit.ts` (~10 lines) and in `export-lyrics.ts:17-35`. Or, cheaper and more honest: forbid/reject leading pre-bracket text in the audit so the file is normalised. | `song-audit.ts:71,214-269`; `export-lyrics.ts:16-35`; `ecb-syllable-matcher.ts:213-218` |
| `no-timestamps` (0/30) | **Blocks "done" independently of the translation.** The file has `%%youtube 9elvYViwP4g`, so run `npm run timestamps` after the text is final; per `docs/song-standard.md` §4 markers must never be hand-written. | audit output above |

So: the change is **entirely inside `lyric-translator-tools`** (optionally one prompt file, plus
optionally 4 lines to expose fit enforcement). Tab-pinyinizer needs no change *for the
translation itself*; it needs the leading-segment fix to audit it honestly and `npm run
timestamps` to finish the song.

---

## 5. What I could not determine without a paid call

1. **Whether A_v3 (or A_v6_yue) actually reaches 100% exact on this Cantonese text.** No prior
   Cantonese run exists — the two `adhoc` runs under `runs/` are a different song
   (父亲写的散文诗 / `ahabf…`; the `adhoc-a360e04a` run I first matched was that song, and the
   20261027 run has `n_calls: 0`, `outcome: null`). The Mandarin evidence (90% dev / 100% test)
   does not transfer by measurement, only by plausibility.
2. **Whether the model translates 咪高峰 correctly** under a "Mandarin" prompt, and whether
   A_v6_yue's lexicon hint is enough. Needs reading one run's output.
3. **Feel / register quality** of any of the options — no Cantonese song in `data/`, so the
   judge (`G_judge`), leaderboard and human-vote calibration are all Mandarin-only and cannot
   rank Cantonese variants.
4. **Real per-run cost and wall time for this specific file** — extrapolated from $0.1216 / 84 s
   (A_v3, qwen3p8, 32 lines) and `configs/best.json` ($0.117 / 190 s dev). The 30-line Cantonese
   input should land in that band, but it is an estimate.
5. **Whether the `--fit-check-rounds` four-line patch is worth it** (i.e. how many lines A1
   leaves off-target on the first answer). If A1 lands 30/30 exact, the patch is dead weight for
   this song; it is insurance, not a requirement.
6. **Whether `ecb-syllable-matcher` emits warnings on a line-exact translation** — expected none
   (each sub-chunk gets exactly its Han-character target), unverified until one placement run.
