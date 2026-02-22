# Conversion prompt: lyric translation for Ultimate Guitar tab

Use this document when asking an LLM to translate or convert lyrics in the **intermediate representation (IR)** produced by tab-pinyinizer. The LLM’s output will be turned back into an Ultimate Guitar–style chord tab by the tool `ir-to-tab`.

**LM format** is the line-based, tab-separated text format used in `.ir.lm.txt` files (designed for use with a language model). See “Input/output format” below for the exact structure.

---

## Your task

You receive a text file in LM format. Your job is to produce the **same format** with lyrics and/or pinyin filled or converted according to the user’s instructions:

- **Pinyin → Chinese**: the lyrics column is pinyin; you fill the lyrics column with the corresponding Chinese characters and keep (or copy) pinyin in the pinyin column.
- **Chinese → pinyin**: the lyrics column is Chinese; you fill the pinyin column with the correct pinyin for each segment.

Leave structure and chords unchanged. The result will be fed to `ir-to-tab` to generate the final chord sheet. If you change the format or drop columns, the conversion will fail or produce wrong alignment.

---

## Input/output format: LM text

The file is plain text with:

1. **Optional metadata** at the top: lines like `key: value` (e.g. `title: My Song`). No leading space; one key-value per line.
2. **Blank line** after metadata (if any).
3. **Sections**: each section has:
   - A **section header** on its own line: `[SectionName]` (e.g. `[Intro]`, `[Verse 1]`, `[Chorus]`). No spaces inside the brackets in the header.
   - Then one **segment line** per chord–lyric pair in that section.
   - A **blank line** after the last segment of the section (before the next section or end of file).

Each **segment line** has exactly three columns separated by **tab** (`\t`):

- **Column 1 – chord**: chord symbol (e.g. `Am`, `G`, `C/G`). Do not change.
- **Column 2 – lyrics**: lyric text (syllables/words under that chord). May be pinyin or Chinese depending on the conversion direction.
- **Column 3 – pinyin**: romanization (pinyin). May be empty in the input.

So: **chord TAB lyrics TAB pinyin**, one segment per line. Spaces inside the lyrics or pinyin fields are intentional (they control alignment in the final tab).

---

## Rules you must follow

1. **Preserve structure**
   - Keep every metadata line (`key: value`) and every section header line (`[SectionName]`) exactly as in the input.
   - Keep the same number of sections and the same number of segment lines per section.
   - Use a single blank line between sections; no extra blank lines in the middle of a section.

2. **Preserve the chord column**
   - Copy column 1 (chord) character-for-character. Do not add, remove, or change chords.

3. **Preserve column count and separators**
   - Every data line must have **exactly three fields** separated by **tabs**.
   - Do not add a fourth column, and do not replace tabs with spaces. Empty fields are allowed (e.g. `Am\t\t` for chord-only).

4. **What you may change**
   - **Column 2 (lyrics)** and **column 3 (pinyin)** only as requested (pinyin→Chinese or Chinese→pinyin).
   - Keep alignment: preserve similar spacing so chord–syllable alignment still makes sense in the final tab.

5. **Encoding and line endings**
   - Output plain UTF-8 text.
   - Use Unix line endings (single `\n`).

---

## Converting from pinyin to Chinese

**When to use:** The tab was written with **pinyin in the lyrics** (e.g. from a source like `jrayty-in.txt`). You convert the lyrics column to **Chinese characters** and keep the pinyin in the pinyin column for reference.

**Input (excerpt):** Lyrics column is pinyin; pinyin column may be empty or same as lyrics.

```
title: Li Jian (李健) - 假如爱有天意

[Verse 1]
Am		dang tian bian na ke xing chu xian
G		ni ke zhi wo you kai shi xiang nian
C		you duo shao ai lian
C		zhi neng yao yao xiang wang
Am		jiu xiang yue guang sa xiang hai mian

```

**Output:** Lyrics column is Chinese; pinyin column keeps the pinyin (for display or reference in the final tab).

```
title: Li Jian (李健) - 假如爱有天意

[Verse 1]
Am		当天边那颗星出现		dang tian bian na ke xing chu xian
G		你可知道我开始想念		ni ke zhi wo you kai shi xiang nian
C		有多少爱恋		you duo shao ai lian
C		只能遥遥相望		zhi neng yao yao xiang wang
Am		就像月光洒向海面		jiu xiang yue guang sa xiang hai mian

```

Chord column unchanged; section headers and blank lines preserved. Each line stays one segment with three tab-separated columns.

---

## Converting from Chinese to pinyin

**When to use:** The tab has **Chinese characters in the lyrics** column. You fill the **pinyin column** with the correct pinyin for each segment (tones optional or as requested).

**Input (excerpt):** Lyrics column is Chinese; pinyin column is empty.

```
title: 某首歌

[Verse 1]
Am		当天边那颗星出现
G		你可知道我开始想念
C		有多少爱恋
Am		就像月光洒向海面

```

**Output:** Lyrics column unchanged; pinyin column filled with pinyin.

```
title: 某首歌

[Verse 1]
Am		当天边那颗星出现		dāng tiān biān nà kē xīng chū xiàn
G		你可知道我开始想念		nǐ kě zhī wǒ yòu kāi shǐ xiǎng niàn
C		有多少爱恋		yǒu duō shǎo ài liàn
Am		就像月光洒向海面		jiù xiàng yuè guāng sǎ xiàng hǎi miàn

```

Chord column and lyrics column unchanged; pinyin added in the third column. Section headers and blank lines preserved. Use numbered tone marks (ā á ǎ à) or tone numbers as the user prefers.

---

## After you respond

The user will save your output to a file (e.g. `song.ir.lm.txt`) and run:

```bash
npm run ir-to-tab -- song.ir.lm.txt song-final.txt
```

That produces the final Ultimate Guitar–style chord tab. If your output does not follow the LM format exactly (tabs, three columns, section headers, blank lines), the tool may misparse or the final tab will be wrong.
