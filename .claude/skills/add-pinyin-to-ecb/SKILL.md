---
name: add-pinyin-to-ecb
description: Add a pinyin track to a chinese-only .ecb song file, turning %%languages chinese into chinese, pinyin with tone-mark-free, space-separated-per-character pinyin on every lyric segment. Use when asked to "add pinyin" to a song — the target is almost always an existing file in songs/ (e.g. songs/<name>.ecb), not a file to create from scratch.
---

Add pinyin to a `chinese`-only `.ecb` file by following `prompts/add_pinyin_to_ecb.md`
directly against the target file, using your own knowledge of Chinese pronunciation — this is
not a script/tool-driven skill like `add-syllable-matched-translation`, just a pointer to the
right prompt plus repo-specific context for where the target file lives.

**Finding the target file:** when the user names a song ("add pinyin to the mercury records
song"), the file is almost always already in `songs/*.ecb` — search there first (e.g.
`grep -ril "<name>" songs/`) rather than asking the user for a path or assuming a new file
needs to be created.

**Doing the conversion:** read `prompts/add_pinyin_to_ecb.md` for the exact rules (update
`%%languages` to `chinese, pinyin`; every `[Chord]Chinese` segment becomes
`[Chord]Chinese|pinyin`; no tone marks; single space between each character's pinyin; chords,
brackets, section headers, and chord-only/empty segments are left untouched). Apply those
rules directly to the target file with your Edit/Write tools — do not treat the prompt as
something to paste into a different system, and do not wrap the file in triple backticks as
the prompt's own output-format instruction says (that instruction is for when the prompt is
used standalone outside this repo).

For the ECB format itself (`%%languages`, lyric segments, leading/trailing whitespace
stripping, chord-only segments), see `prompts/general_spec.md` if anything in the pinyin
prompt is unclear.

After editing, sanity-check with `git diff`: every changed lyric line should gain exactly one
`|pinyin` per existing `Chinese` segment, chord-only lines (e.g. `[E] [Eaug] [E6]`) should be
unchanged, and repeated sections (identical verses/choruses elsewhere in the file) should get
identical pinyin.
