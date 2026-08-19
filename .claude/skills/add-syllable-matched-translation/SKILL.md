---
name: add-syllable-matched-translation
description: Insert or replace a syllable-matched translation track in a .ecb song file, using src/ecb-syllable-matcher.ts to mechanically re-segment translated text onto the file's existing chord/lyric segment boundaries. Use when given a target .ecb file plus an ordered table of original-language + translated-text row pairs (e.g. syllable-match-debug/*.txt) that need syllable-count-synced insertion, rather than hand/eyeballed redistribution.
---

Insert (or replace) a syllable-matched translation track in an `.ecb` file, using the
`src/ecb-syllable-matcher.ts` script to do the mechanical syllable-distribution work.

For the ECB format itself — `%%languages`, lyric segments, chords, section headers, free
text — see `prompts/general_spec.md`, which is shared context for this skill exactly as it is
for `prompts/translation_spec.md`. Read it first if you have not already.

**You will be given:**
- a target `.ecb` file to edit,
- a syllable-matched translation table: ordered rows of original-language text paired with
  translated text, sometimes with a syllable count annotated per row (e.g. "11 (+1)"). Treat
  those counts as informational only — the script recomputes real syllable counts itself and
  its numbers are authoritative, not the table's.

Work through the five steps below in order, using your Read/Edit/Bash tools directly — this
skill runs inside the repo, not as a prompt pasted into some other system.

## 1. Pick the line range

Read the target `.ecb` file and find the contiguous block of lines the table's rows cover.
Choose `startLine` and `endLine` (1-indexed, inclusive, matching the file's actual source
lines) so that this block is *exactly* what the table covers — start at the first line whose
Chinese the table's first row begins with, end at the last line whose Chinese the table's
last row ends with. Do not guess row-by-row which line each row lands on; you don't need to.
The script itself concatenates all Chinese in your chosen line range and all Chinese in the
table's rows (whitespace stripped from both) and fails loudly with a character-position diff
if they don't match exactly. A wrong range shows up immediately as a hard error, so treat a
first attempt as disposable — read the error, adjust the range, retry.

Two things commonly make the "right" range not just "first table row to last table row" in
source-line terms:
- **Filler/onomatopoeia content the table doesn't cover** (e.g. `嗯嗯...`/`啦啦啦啦...` lines)
  must be *excluded* from the range — see step 4 for what to do with it instead. Watch for the
  filler onset being fused into the same segment as the last bit of real content (e.g.
  `打湿我眼眶 嗯嗯` as one `[chord]` segment) — in that case either extend the range and add your
  own synthetic filler row(s) to `rows` so the whole fused segment is covered by the script in
  one pass, or exclude the whole segment and hand-fill it in step 5. Either is fine; pick one
  and be consistent.
- The table's rows may not align to line boundaries in the `.ecb` file at all (a row can span
  two source lines, or one line can hold parts of two rows). That's fine and expected — the
  script handles sub-line, sub-segment alignment internally. You only need the outer range
  right, not a row-to-line mapping.

## 2. Handle script-variant mismatches

The script requires the table's original-language text and the `.ecb` file's Chinese to match
character-for-character (after stripping whitespace) over the chosen range — no fuzzy
matching, no normalization. If the table is in a different script variant than the file (for
example, a table in traditional Chinese being applied to a file whose `%%languages chinese`
column is simplified), you must convert the table's Chinese to the file's variant yourself
before building the script's input. Do this using your own knowledge of Chinese
script-variant character mappings, character by character — do not shell out to a conversion
tool or library; there isn't one wired into this workflow, and the script itself does zero
conversion.

## 3. Call the script

Build one JSON object matching `src/ecb-syllable-matcher.ts`'s input schema (re-check that
file's header docstring if anything below is unclear — it is the authoritative source, not
this skill):

```json
{
  "ecbFilePath": "songs/legend.ecb",
  "startLine": 27,
  "endLine": 29,
  "chineseLanguageIndex": 0,
  "rows": [
    { "originalChinese": "宁愿用这一生等你发现",
      "translatedText": "I'd rather spend my life waiting to be found" },
    { "originalChinese": "我一直在你身旁从未走远",
      "translatedText": "I've been right by your side, never far away" }
  ]
}
```

Field notes (see the script's docstring for the full list):
- `ecbFilePath` — required, path to the target file (relative paths resolve against cwd).
- `startLine` / `endLine` — required, 1-indexed inclusive, from step 1.
- `chineseLanguageIndex` — optional, defaults to `0`; only set it if `chinese` isn't the first
  language in that file's `%%languages` list.
- `lyricToolsDir` — optional, defaults to `~/workdir/lyric-translator-tools`; only set it if
  that tool lives somewhere else on this machine.
- `rows` — required, non-empty array of `{ originalChinese, translatedText }`, in order,
  already converted to the file's script variant per step 2. `originalChinese` is the row's
  source-language text (Chinese here); `translatedText` is the row's translation.

Write the JSON to a scratch file with your Write tool (`convert_workdir/` is the project's
gitignored scratch directory for exactly this kind of ad hoc intermediate file — don't treat
anything written there as needing to persist), then run with Bash:

```bash
npm run build:cli && node dist/ecb-syllable-matcher.js convert_workdir/<your-input>.json
```

`npm run build:cli` is a required prerequisite every time — the compiled `dist/` output must
exist and be current before `dist/ecb-syllable-matcher.js` can run. If the script exits
non-zero with a mismatch/length error, that's step 1 or step 2 needing a fix, not a bug to
work around — adjust the range or the script-variant conversion and rerun.

## 4. Handle a new language column, and filler outside the range

**New column:** if the target language isn't yet in the file's `%%languages` header (e.g.
adding `english` to a `chinese, pinyin`-only file), update that header yourself with your Edit
tool — the script only reads the file, it never edits `%%languages` or anything else. Add the
new language name in the position you intend to place its text in each segment's
`lang1|lang2|...` list (typically appended at the end).

**Filler outside the range:** once a new language column exists, *every* non-empty lyric
segment in the file needs a value for it, not just the ones inside your chosen range (see
`general_spec.md`: "A non-empty lyric segment should have as many languages as this parameter
specifies"). Content you deliberately excluded from the range in step 1 (onomatopoeia filler)
still needs something in the new column. If you used the synthetic-filler-row approach from
step 1, this is already handled by the script's output. Otherwise, fill these in yourself,
using judgement (e.g. transliterating `嗯嗯...` as English `en en...` and `啦啦啦啦...` as
`la la la la...`, matching the existing pinyin column's own transliteration style). This is a
stylistic call, not a mechanical one — **flag your choice explicitly to the user** in your
final response rather than silently picking something and moving on.

## 5. Apply the result

The script prints JSON to stdout: `{ "segments": [{lineNumber, segmentIndex, chinese, newText}, ...], "warnings": [...] }`.

For each entry, use your Edit tool on the `.ecb` file: find that `lineNumber`'s line, find the
segment at `segmentIndex` (0-indexed left-to-right, counting chord-only segments too — the
same indexing the segment's own `[chord]` position implies), and place `newText` into that
segment's `lang1|lang2|...` list at the position matching the language you're adding or
replacing — append a new `|`-separated slot when adding a brand-new column, or overwrite the
existing slot in place when replacing a language that's already there. Leave the chord
bracket, every other language's text in that segment, and every other line untouched — the
script never reads or touches them, and neither should your edit. `chinese` in the output is
only for your own sanity-checking that you're editing the segment you think you are; it is
not something to write anywhere.

After editing, verify with `git diff`: confirm every change is a translation-column change
(no chord, chinese, pinyin, section header, blank line, or free-text change slipped in), and
that every non-empty segment in the file has exactly as many `|`-separated fields as
`%%languages` declares.

Finally, surface the script's `warnings` array back to the user verbatim if it's non-empty
(e.g. a row running short of syllables for one of its sub-chunks) — don't silently absorb or
paraphrase these; the user should see exactly what the script flagged.
