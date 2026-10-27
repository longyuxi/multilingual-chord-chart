# Wholesale retranslation recipe

How to replace a song's English track with a fresh, syllable-matched translation — the procedure
validated end to end on `songs/drowning_sorrows.ecb` (`tab-pinyinizer-i8v.4.6`). Use it when the
standard (`docs/song-standard.md`) fails a file on syllable fit badly enough that patching lines
would mix two voices; for a single bad line, edit that one line instead.

Validated numbers: 37 lines, harness 37/37 exact on the **first** attempt, **$0.26** and **169 s**
of model time, 11 s of placement, 0 matcher warnings, audit 11 mismatches → 0. Budget
**$0.25–0.35 and ~3 minutes per song**; the harness's own `configs/best.json` figure ($0.117/song)
is measured on its dev split and understates raw lyrics by ~2×.

## Pieces

| piece | what it is |
| --- | --- |
| the harness | `lyric-translator-tools`' `harness.K_translate` — prompts/model/params from that repo's `configs/best.json` (currently prompt `A_v3`, model `qwen3p8-2p4t-a95b`). Cantonese uses `--prompt A_v6_yue`. |
| fit enforcement | `--fit-check-rounds 2` on `K_translate` (`lyric-translator-tools-0v2`): the harness's own scorer forces the counts instead of trusting the model's claim. |
| the placer | `src/ecb-syllable-matcher.ts` — re-segments the translated lines onto the file's existing chord/segment boundaries, deterministically. |
| the gate | `npm run audit-songs -- songs/<name>.ecb` — must end with no `line-syllable-mismatch`, no `segment-syllable-mismatch`, no `bad-field-count`, no `empty-track`. |

## Recipe

`SONG` is the file stem; `START`/`END` are the first and last source lines of the lyric block.

```bash
# 0. worktree + build (project convention: never edit the main checkout)
git -C /Users/longyuxi/workdir/tab-pinyinizer worktree add ../tp-${SONG} -b retranslation-${SONG}
cd ../tp-${SONG} && ln -s /Users/longyuxi/workdir/tab-pinyinizer/node_modules node_modules
npm run build:cli
npm run audit-songs -- songs/${SONG}.ecb          # record the baseline on the issue

# 1. extract the Chinese: one row per lyric line, ALL whitespace stripped
#    (do NOT use `npm run export-lyrics`: its bare `chinese`/`pinyin` header lines are
#    parsed as lyric rows by the harness, shifting every count by one)
# 2. translate (FIREWORKS_API_KEY lives in that repo's .env)
cd /Users/longyuxi/workdir/lyric-translator-tools
uv run python -m harness.K_translate <repo>/convert_workdir/${SONG}_zh.txt \
  --fit-check-rounds 2 --json --out <repo>/convert_workdir/${SONG}_result.json
#    (Cantonese: add --prompt A_v6_yue)
#    every line must be exact in the `Match?` column — off-by-one at line level becomes
#    off-by-one at SEGMENT level somewhere

# 3. place
cd ../tp-${SONG}
node dist/ecb-syllable-matcher.js convert_workdir/${SONG}_matcher_input.json \
  > convert_workdir/${SONG}_segments.json
#    non-empty `warnings` = a row ran out of syllables for a sub-chunk: re-ask the harness,
#    never patch by hand

# 4. apply (Edit tool), 5. verify, 6. commit — see the wrinkles below
```

## Wrinkles (all encountered, all measured)

- **`export-lyrics` is not harness-ready** — its `chinese`/`pinyin`/`english` header lines become
  lyric rows. Extract from the `.ecb` directly.
- **Strip all whitespace when building rows**, not just the ends: ECB Chinese carries internal
  spaces from line wrapping, and the placer compares with whitespace removed on both sides.
  Concatenate segments left to right; do not reorder by chord.
- **The two tools count different things, silently.** The harness and the placer target Han
  characters; `audit-songs` targets romanization tokens. They agree on a healthy file. Gate
  before spending: per line, `audit sung == len(row)`. If the audit shows `romanization-mismatch`
  warnings, those disagree and a green harness can still produce a red audit. Do **not** "fix"
  pinyin typos as a side effect — that is an unreviewed change to a track you were not asked to
  touch.
- **Apply in contiguous blocks, not line by line.** Repeated stanzas make a single line's
  `oldText` non-unique, so a per-line edit either fails or hits the wrong copy. Six line pairs in
  `drowning_sorrows` were byte-identical.
- **Malformed segments need a second fix.** A segment with fewer fields than `%%languages`
  (`无处|wu chu`) gets text from the placer but the field still has to be *appended*. The matcher
  does not report this in `warnings`, and `bad-field-count` does not stop it — always re-run the
  audit. Same handling for an existing column with empty fields, and for adding a brand-new
  column (`%%languages` must be edited by hand; the placer only reads).
- **Songs with no romanization track need pinyin first** (`add-pinyin-to-ecb` skill, one
  token per Han character, no tone marks), because until then the file has no sung-syllable
  target and the audit reports `wrong-track-layout`.
- **Expect mid-word hyphen splits at chord seams** (`tomor-`/`row`, `most ab-`/`surd`) and expect
  more than the old text had. It is legitimate — the catalog's own examples do it — and it is the
  price of exact segment fit. Do not hand-edit them away; that reintroduces a segment mismatch.
- **Traditional vs simplified: the placer normalizes nothing.** If it fails at a position where
  both sides "look the same", the model echoed the other script variant — fix the row text.
  Same for full-width spaces.
- **Punctuation is carried, not stripped** — the syllable counts were computed on those exact
  strings, so never post-process the output.
- **Provenance goes on the commit**: the English is machine-drafted by the harness and
  placement-checked by the placer, not human-written prose. The per-song `human` label exists so
  a person reads the diff; the audit proves fit, never taste.
