# How fixed-width systems render Chinese (CJK) characters

This doc summarizes how chord+lyric alignment works (or doesn’t) in editors and terminals when mixing Latin and CJK.

## Unicode: East Asian Width (UAX #11)

The standard model for **terminal** column width is [Unicode UAX #11 (East Asian Width)](https://unicode.org/reports/tr11/):

- **Wide (W)** and **Full-width (F)**: 2 columns (e.g. CJK ideographs, full-width punctuation).
- **Narrow (N)**, **Half-width (H)**, **Neutral**, and **Ambiguous (A)** in non‑EA context: 1 column (e.g. Latin, digits, ASCII space).

So in a compliant terminal, each CJK character uses 2 columns and each Latin character 1. Libraries like **wcwidth** / **wcswidth** (POSIX, and the npm `wcwidth` package) implement this so that alignment and cursor position match the standard.

## VS Code and other editors

In **VS Code**, character width is **font‑dependent**, not guaranteed to follow UAX #11:

- [Issue #72743](https://github.com/microsoft/vscode/issues/72743): “Chinese characters are not exactly equal to the width of two English letters.”  
- Resolution: *“This is determined by the font.”* So a Chinese character may not render as exactly 2× a Latin character; it can be slightly more or less depending on the font.

So:

- **Spaces only**: You can’t get perfect alignment in VS Code (or similar editors) by adding/removing spaces if the font doesn’t use a strict 2:1 (full‑width : half‑width) ratio.
- **Same in other apps** (e.g. Ultimate Guitar): If the font doesn’t treat CJK as exactly 2 Latin widths, chords and Chinese lyrics will never line up perfectly with space-based padding alone.

## What we do in this project

- The **ir-formatter** uses **column width** (via the same rules as `wcwidth`: Unicode East Asian Width) to decide how many spaces to add so that chord / lyrics / pinyin lines have the same total width **in a compliant environment** (e.g. terminal, or an editor with a font that follows 2:1).
- In **terminals** that use wcwidth-style logic, alignment should be correct.
- In **VS Code / Ultimate Guitar**, alignment can still be off because the **font** decides the actual pixel width of each character; we only control the number of space characters, not the font metrics.

## Ultimate Guitar: fonts used

From a saved tab page (e.g. `ug_page_example/` in this repo), the tab viewer preloads:

| Asset | Likely font |
|--------|-------------|
| `ug/fonts/ug/memvYaGs...woff2` | Google Fonts Latin sans (e.g. Source Sans 3) |
| `ug/fonts/muse/muse-sans/v4/MuseSans-Variable.woff2` | **Muse Sans** (proportional) |
| `ug/fonts/ug/L0xTDF4xlVMF-...woff2` | **Noto Sans SC** (Simplified Chinese) |
| `ug/fonts/muse/muse-display/.../MuseDisplay-Harmony.woff2` | **Muse Display** (headings) |

There is **no separate monospace or "tab" font**. Chord and lyric lines are almost certainly rendered with the same stack: a proportional Latin sans (Muse Sans or the Google Font) and **Noto Sans SC** for CJK. So:

- **Width to anticipate:** UG does not use a fixed 2:1 (CJK : Latin) column model. Character width is whatever the font's metrics say; Noto Sans SC and Muse Sans are proportional, so we cannot derive a single "UG column width" rule. Our formatter uses **wcwidth** (UAX #11), which matches terminals and duospaced fonts, not UG's actual rendering.
- To mimic UG's layout exactly you would need to measure **Noto Sans SC** and the Latin font at the same size (e.g. in a headless browser or with a font metrics API) and use those widths when padding. That's out of scope for this project; we stick to UAX #11 for portability.

## If you need better alignment in an editor

- Use a **monospace (or “duospaced”) font** where full‑width characters are exactly twice the width of half‑width (e.g. some CJK-capable monospace fonts).
- Or view/edit the same file in a **terminal** that uses East Asian Width for cursor/display.
