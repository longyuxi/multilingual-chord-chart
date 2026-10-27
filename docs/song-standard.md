# The song standard

What a file in `songs/` has to be before it counts as done. This is the human-readable half of
`npm run audit-songs` (`src/song-audit.ts`); where the two could drift — the tolerances — the
tool's defaults are authoritative, and its output is the verdict.

The bar is deliberately about *shape*, not taste: tracks present, syllables matched, every line
timed, text clean. Whether the English is good is a human judgement, not this document's.

## 1. Track layout

| Song type | `%%languages` |
| --- | --- |
| Mandarin (国语) | `chinese, pinyin, english` |
| Cantonese (粤语) | `chinese, jyutping, english` |
| English | `english` |

- **Track 1** is the language actually sung, in Han characters. It is never romanized.
- **Track 2** is the **romanization** of track 1: space-separated, one token per sung
  syllable, no tone marks. `pinyin` for Mandarin, `jyutping` for Cantonese. Romanization is the
  requirement, not pinyin specifically — a Cantonese file using `jyutping` conforms.
- **Track 3** is the English translation, and the track is named `english`. Not `translation`:
  the viewer keys its column headings off these names, and one catalog-wide name keeps the
  auditor and the translation tools from special-casing.
- Every non-empty segment carries exactly as many `|`-separated fields as `%%languages`
  declares, and no declared track is left empty in a segment where a sibling track has text.
  (Spec: `prompts/general_spec.md`.)

## 2. Metadata

Required: `%%title`, `%%artist`, `%%languages`, `%%youtube`, `%%transpose` (which may be `0`).

`%%youtube` is mandatory even for a song nobody intends to time by hand. Every marker is
relative to *that video's* 0:00, and the timestamp pipeline refuses to time a song against any
other audio (`docs/timestamp-pipeline.md`), so a file without it can never be timed.

## 3. Syllable match

The translation has to fit the melody, which means it has to fit the syllable count line by
line — not "roughly", and not only in total.

**How the two counts are defined**

- *Sung syllables*: the token count of the file's own romanization column, per segment. One
  whitespace-separated token is one sung syllable, which is exactly what the author says is
  sung (and stays right for erhua and neutral tones). If a file has no romanization track at
  all — already a track-layout failure — the auditor falls back to counting Han characters
  after NFKC normalization.
- *Translated syllables*: `lyric-translator-tools`' CMU-dictionary count
  (`syllable_tools/A_syllables.annotate_en_line`, via `C_cli.py`), which is the same function
  `src/ecb-syllable-matcher.ts` uses to *place* translation text. Auditor and placer therefore
  agree on what "matched" means. Hyphen-continued words are counted as written: `exag-` +
  `gerate` across two segments sums to the word's syllables.

**Tolerances**

| Level | Requirement |
| --- | --- |
| Line | `|sung − translated| ≤ 1` |
| Segment | `|sung − translated| ≤ 2` |

Line is what the singer phrases, so one syllable either way is a judgement call about how a
phrase is held; two or more is a translation that does not fit the music.

Segments are chord boundaries *inside* a line and get twice the slack, because a line that fits
can still split unevenly and still be right. The reference case is the hand-made
`condensed_blue_whale`:

```
[Am]蓝鲸的宿|lan jing de su|blue whale's[Am7/G]命|ming|destiny
         4 syllables             2 syllables  1 syllable  3 syllables
```

5 against 5 for the line — perfect — while the two segments are off by 2 in opposite
directions. That is correct placement at a chord seam, so the segment rule must not fail it.
Segments off by more than 2 are not seams; they are text pushed to the wrong side of a chord
boundary, and `ecb-syllable-matcher` can usually fix them without writing new English.

**What the numbers are not**: a green syllable check does not mean the English is faithful or
singable. A translation can hit every count and still be wrong. That review is the `human`
label's job (`tab-pinyinizer-i8v.4`).

## 4. Timestamps

Every lyric line carries a marker: `@M:SS` either on its own line directly above the lyric line
or inline before a segment (grammar in `prompts/general_spec.md`). Times are always relative to
the file's own `%%youtube` video, and are written with `npm run timestamps` — never by hand,
because a hand-written marker and an aligned marker disagree about the audio, and the next
regeneration would silently move it.

The viewer renders whatever it finds, so an untimed file still works; it just cannot be played
along with. A file that is *partly* timed is a failure, because a viewer that seeks for some
lines and not others is worse than one that never seeks.

## 5. Text hygiene

- No Kangxi-radical or compatibility codepoints standing in for Han characters: `⼭` (U+2F2D)
  instead of `山`, `⼤` instead of `大`. They look right on screen and are wrong everywhere else
  — search misses them, copy/paste yields characters no input method or dictionary matches, and
  Han counts undercount them, `lyric-translator-tools`' own `annotate_zh_line` included.
  `as_wished.ecb` had 27 of these (`tab-pinyinizer-i8v.5`).
- Punctuation inside lyric text is ASCII, matching the rest of the catalog. Full-width
  punctuation is a warning, not a failure.

## 6. Explicitly out of scope

Chord correctness, transposition/key, section names, `%%subtitle`-style extras, and the
literary quality of the translation. This standard measures shape so that the work left over is
the part only a human can judge.

## 7. Checking

```bash
npm run build:cli
npm run audit-songs                       # table over all of songs/
npm run audit-songs -- songs/a.ecb        # one file
npm run audit-songs -- --check            # exit 1 if any file fails a hard check
npm run audit-songs -- --json             # per-line detail, for turning into tasks
npm run audit-songs -- --verbose          # per-finding messages with line numbers
npm run audit-songs -- --format md        # markdown table for an issue
```

Finding codes, with severity:

| Code | Severity | Meaning |
| --- | --- | --- |
| `missing-metadata` | error | one of the required `%%` keys is absent |
| `missing-languages` | error | no `%%languages` at all |
| `unknown-song-type` | error | cannot tell Mandarin / Cantonese / English-only |
| `wrong-track-layout` | error | tracks are not the layout for that song type |
| `missing-translation-track` | error | the layout's later tracks are absent |
| `wrong-track-name` | error | translation track is named `translation` |
| `bad-field-count` | error | segment field count ≠ `%%languages` length |
| `empty-track` | error | a declared track is empty where a sibling has text |
| `line-syllable-mismatch` | error | line off by more than 1 syllable |
| `segment-syllable-mismatch` | error | segment off by more than 2 syllables |
| `no-timestamps` | error | no line carries a marker |
| `partial-timestamps` | error | only some lines carry markers |
| `unnormalized-chars` | error | Kangxi radicals / compatibility ideographs |
| `fullwidth-punctuation` | warning | full-width punctuation in lyric text |
| `romanization-mismatch` | warning | romanization tokens ≠ Han characters in a segment |

`--check` fails on `error` only; warnings mark text worth a look, not a defect.
