# king_of_karaoke_cantonese — full English retranslation (tab-pinyinizer-i8v.4.8)

Branch `i8v48-cantonese-redo`, worktree `/Users/longyuxi/workdir/tp-i8v48-canto`.
Committed `aa3628f` — 1 file, 30 lines changed (third track only). Not closed, not pushed, not merged;
`human` label kept, `needs-merge` added, status `in_progress`.

Caveat on inputs: `research/cantonese-translation-path.md` (the recon I was told to read first) does not
exist in the repo or on any branch — `research/` is not in git at all. Nothing was missing from the
briefing itself (mechanism, prompt, traps, cost estimate were all restated in the task), so I proceeded on
the task text; the recon file is worth recovering/committing if it exists elsewhere.

## Mechanism actually used

```
cd ~/workdir/lyric-translator-tools
uv run python -m harness.K_translate <zh-lines.txt> --prompt A_v6_yue --fit-check-rounds 2 --json --out <out.json>
```

Input was rebuilt from THIS file, not from the repo's stale `king_of_karaoke.txt`: 30 lyric lines,
first-track Chinese only, section markers kept, leading pre-bracket text included (lines 8, 10, 11, 29 —
that text is a full chordless `chinese|jyutping|english` segment, easy to drop by accident). Traditional
characters untouched; the matcher's character-for-character check passed on the first try.

Model `accounts/fireworks/models/qwen3p8-2p4t-a95b`, prompt `A_v6_yue`, params `{}`.

## Harness numbers

| metric | value |
| --- | --- |
| lines | 30 source / 30 English / 0 extra / 0 missing |
| exact | 30/30 (100%) |
| within ±1 | 30/30 (100%) |
| MAD / max abs diff | 0.0 / 0 |
| attempts | 1 (outcome `ok`, no retry) |
| cost | **$0.1776** |
| wall | **88 s** |

Harness target agrees with the file's sung count (jyutping tokens) on 29/30 lines; the exception is the
line containing `K歌之王` (jyutping has 12 tokens because `K` is one, Han is 11). The harness target for it
is 11, so its line is 11 vs 12 sung — inside ±1, no action needed, as the recon predicted.

## Placement

`node dist/ecb-syllable-matcher.js` with rows of `{originalChinese: this line's Chinese, translatedText:
harness line}`, `startLine 8`, `endLine 47`, `chineseLanguageIndex 0`. 116 segments emitted, **warnings:
[]**.

One manual step, arithmetic only, no wording change: **line 42** (`你 怎麼竟 / 然 / 說 K歌之 / 王 是 / 我`).
The line's phrase is "You how dare you name me Karaoke King" (11 syl) and the matcher's syllable array
cannot split `Karaoke` (one flat entry, weight 4), so it emitted `You how dare you | name | me | (empty) |
Karaoke King` — an empty track on `[G]王 是` plus a +3 segment error. Fix was to redistribute the *same
words* by the jyutping token targets: `You how (2) | dare (1) | you name me (3) | Karaoke (4) | King (1)`
against targets `4 1 4 2 1` — every diff ≤2, line 11 vs 12. No word was added, removed or changed.

## Verification

```
npm run build:cli && npm run audit-songs -- songs/king_of_karaoke_cantonese.ecb --verbose
king_of_karaoke_cantonese.ecb  cantonese  chinese,jyutping,english  0/30  30ok/0off  no-timestamps
findings: no-timestamps (i8v.3)
warning:  romanization-mismatch 1 segment (line 42) — pre-existing; I re-ran the audit on HEAD's version
          of the file and it reports the same warning (it is the `K`, independent of the English).
```

No `line-syllable-mismatch`, no `segment-syllable-mismatch`, no `bad-field-count`, no `empty-track`
(before: 16 off-by->1 lines, 2 segment errors).

Diff audit: a whitespace-insensitive structural diff (chords + chinese + jyutping + metadata + section
headers + blank lines) is **identical on all 47 lines**; only the 3rd `|` field changed, on all 30 lyric
lines. Style note: the old lines had a space before the next `[chord]`; the matcher's output has none
(`Don't frown[C]…`). Harmless — the parser strips whitespace — and it matches `format_spec`'s own worked
example.

## Five hand spot-checks (Cantonese reading, not Mandarin)

1. **L41** `[F#m7-5]高峰都因我動…|the microphone is moved;` for `咪高峰都因我動容`
   — 咪高峰 = microphone, correct. This was the trap: a Mandarin reading gives 咪 "meow" + 高峰 "peak",
   and the old translation dodged it with "The micro-/phone". New text is right and reads better.
2. **L22** `heard vows like 'Fer-[Am]ris wheel of bliss'` for `誓言如幸福摩天輪`
   — 幸福 = bliss/happiness, `Ferris wheel` preserved as an image. Faithful.
3. **L26** `who minds my be-[C/E]ing sad?` for `誰不捨我難過`, and `who's trash` for `誰是垃圾`
   — 難過 as "being sad" (not 难过="hard to pass"), 垃圾 as garbage/trash. Both correct Cantonese.
4. **L14** `What else can I hold you with when I can never thrill you` for
   `還能憑甚麼擁抱若未能令你興奮` — grammatical and singable, but it **drifted**: 憑甚麼 ("on what
   grounds / what else is there to rely on") got folded into "hold you with", and 若 ("if") became
   "when … never". Meaning is adjacent, not exact. My judgement: acceptable-in-song, but it is the
   weakest *semantic* line of the verse.
5. **L29–30** `your yawn is so final that it / melts me away, undone` for
   `你那呵欠絕得不能絕` — "so final" is a reach for 絕得不能絕 ("so heartless it can't be outdone"),
   and `undone` is filler for the count. Passes, feels slightly padded.

## Explicit verdicts for the human review

**Better than what it replaced — clearly.** The old English was a word-for-word gloss ("I sing not enough
moving don't you frown eyebrows", "Worked hard to write twenty never-abandoning songs Also giving you love
that's too fierce"), and 16/30 lines did not fit the melody. The new text fits 30/30 at line and segment
level, keeps the song's images (heart's blood, Milky Way, Ferris wheel of bliss, microphone, twenty songs),
and the two choruses are translated identically (L20–23 vs L35–38), which is right for a repeated chorus.

Two lines I would flag as **bad**, not merely syllable-correct:

- **L26, `Give me one street as a gift`** for `分一丁目贈我`. 丁目 here is "a tiny bit" (一丁目 as in
  一丁點), not the Japanese address unit — "one street" is a plain misreading and the old translation
  ("Give a tiny bit to me") was right. This is the one line I would re-translate.
- **L42, `You how dare you name me Karaoke King`** for `你 怎麼竟然說K歌之王是我`. Word order is broken
  ("You how dare you …"); it needs something like "How dare you say the King of Karaoke is me". My L42
  placement fix only moved these words around, it did not fix the grammar.

Lesser: L13 `take all my` should be `takes all my` (the subject is `love love love love so much`); L23/24
splits `hea` / `ven` across lines with no hyphen (it mirrors the original's own 呼天叫 / 地 enjambment, so
I left the model's split alone rather than editing text); L29 `so final`, L30 `undone` are filler-ish.

Provenance: machine-drafted (LLM) and placement-checked; not human-written prose.
