# IR (Intermediate Representation) JSON specification

The IR is a JSON format that represents a chord sheet with explicit chord–lyric alignment. Each logical “cell” is a **segment** with `chord`, `lyrics`, and `pinyin` strings. The structure mirrors how the sheet is laid out: **paragraphs** (sections) contain **lines**, and each line is a sequence of **segments**.

## Top-level object

| Field        | Type     | Required | Description |
|-------------|----------|----------|-------------|
| `meta`      | object   | yes      | Key–value metadata (e.g. title, artist). Keys and values are strings. |
| `paragraphs`| array    | yes      | Ordered list of paragraphs (sections). |

```json
{
  "meta": {},
  "paragraphs": []
}
```

## Meta

`meta` is a plain object. Keys and values are strings. Typical keys (if present) come from the source tab (e.g. title, artist). Empty `meta` is `{}`.

## Paragraph

A paragraph is a section of the sheet (e.g. verse, chorus, intro).

| Field   | Type   | Required | Description |
|--------|--------|----------|-------------|
| `label`| string | no       | Section title (e.g. `"Verse 1"`, `"Chorus"`, `"Intro"`). Rendered as `[label]` in tab output when non-empty. Empty or missing label is not rendered. |
| `lines`| array  | yes      | List of [lines](#line). May be empty. |

Order of paragraphs in the array is document order.

## Line

A line is one row of content: one chord line, one pinyin line, and one lyrics line are derived from the same sequence of segments.

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `segments`| array  | yes      | Ordered list of [segments](#segment). May be empty (blank line). |

## Segment

A segment is one aligned “cell”: one chord, one lyrics slice, one pinyin slice, and optionally one translation slice that align in the output.

| Field         | Type   | Required | Description |
|---------------|--------|----------|-------------|
| `chord`       | string | yes      | Chord symbol(s) for this cell (e.g. `"Am"`, `"F"`, `""`). |
| `lyrics`      | string | yes      | Lyrics for this cell (e.g. Chinese characters). May be `""`. |
| `pinyin`      | string | yes      | Pinyin for this cell (e.g. `"dang tian "`). May be `""`. |
| `translation` | string | no       | Translation for this cell (e.g. English). May be `""` or omitted. |

`chord`, `lyrics`, and `pinyin` are always present. Empty string means no content in that slot. Alignment in the emitted tab is by segment order: segment *i* in a line corresponds to the same column across chord, pinyin, lyrics, and (when present) translation lines.

**Rendering**: When emitting IR to tab text, a translation line is output only when at least one segment in that line has non-empty `translation`. If every segment’s translation is empty or missing, no translation line is emitted for that line.

## Example (minimal)

Title plus one line of content (no section header, so no `label` or empty `label`):

```json
{
  "meta": {},
  "paragraphs": [
    {
      "lines": [
        {
          "segments": [
            {
              "chord": "",
              "lyrics": "李健 - 假如爱有天意",
              "pinyin": "Li Jian (李健) - 假如愛有天意"
            }
          ]
        }
      ]
    }
  ]
}
```

## Example (one verse line)

One verse line with four segments (chord + lyrics + pinyin per segment). Non-empty `label` is rendered as `[Verse 1]`:

```json
{
  "meta": {},
  "paragraphs": [
    {
      "label": "Verse 1",
      "lines": [
        {
          "segments": [
            { "chord": "Am", "lyrics": "当天", "pinyin": "dang tian " },
            { "chord": "G", "lyrics": "边那颗", "pinyin": "bian na ke " },
            { "chord": "C", "lyrics": "星出", "pinyin": "xing chu " },
            { "chord": "C", "lyrics": "现", "pinyin": "xian" }
          ]
        }
      ]
    }
  ]
}
```

## Example (chord-only line)

Intro with chord-only segments (empty lyrics and pinyin):

```json
{
  "label": "Intro",
  "lines": [
    { "segments": [] },
    {
      "segments": [
        { "chord": "F", "lyrics": "", "pinyin": "" },
        { "chord": "G", "lyrics": "", "pinyin": "" },
        { "chord": "Am", "lyrics": "", "pinyin": "" }
      ]
    }
  ]
}
```

## Conventions

- **Encoding**: JSON is UTF-8. Lyrics and pinyin may contain any Unicode (e.g. Chinese, Latin, spaces).
- **Spacing**: Pinyin often includes spaces between syllables (e.g. `"dang tian "`). Chord and lyrics may be empty for that segment.
- **Blank lines**: A line with `segments: []` or a single segment with all empty strings is treated as a blank line when emitting.
- **Section headers**: A paragraph with a non-empty `label` (after trim) emits a section header `[label]` in the tab. Empty or missing `label` emits no section header.

## Generation and consumption

- **Tab → IR**: `tab-to-ir` parses an Ultimate Guitar–style tab and fills `chord` and either `lyrics` or `pinyin` (with `--pinyin`). The other slot is left empty for the agent to fill.
- **Agent**: Edit `lyrics` and/or `pinyin` in place; leave `chord` unchanged.
- **IR → Tab**: `ir-to-tab` reads the JSON and emits chord / pinyin / lyrics lines using the in-house formatter (segment alignment and width rules are described in the repo).

## TypeScript types

The structure is defined in `src/types/ir.ts`: `Ir`, `IrParagraph`, `IrLine`, `Segment`, `IrMeta`.
