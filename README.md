# Tab-pinyinizer

Add pinyin (Chinese phonetic spelling) to existing Chinese song chord sheets using an LM. The LM works on an **intermediate representation (IR)** where chord–lyric alignment is explicit, so it doesn’t need to get whitespace right.

## Pipeline

1. **Tab → IR** – Parse Ultimate Guitar tab with ChordSheetJS, emit IR (JSON + optional LM text).
2. **LM** – Edit the LM text (or JSON): fill the `pinyin` field for each segment.
3. **IR → Tab** – Convert IR back to chord tab (ChordSheetJS `ChordsOverWordsFormatter`).

## Setup

```bash
npm install
npm run build
```

The project is TypeScript; source is in `src/`, compiled output in `dist/`. Use `npm run build` after changes for easier debugging (source maps and types).

## Usage

### Tab → IR (JSON + LM text)

```bash
npm run tab-to-ir -- convert/jrayty-in.txt
# Writes convert/jrayty-in.ir.json and convert/jrayty-in.ir.lm.txt

npm run tab-to-ir -- convert/jrayty-in.txt out.ir.json
# Writes out.ir.json and out.ir.lm.txt
```

### IR → Tab

```bash
npm run ir-to-tab -- convert/jrayty-in.ir.json
# Writes convert/jrayty-in.txt (overwrites; use a different name to be safe)

npm run ir-to-tab -- convert/jrayty-in.ir.lm.txt converted.txt
# Writes converted.txt
```

### Round-trip (sanity check)

```bash
npm run roundtrip -- convert/jrayty-in.txt convert/jrayty-roundtrip.txt
# Parses tab → IR → tab and writes convert/jrayty-roundtrip.txt
```

## IR format

- **JSON**: `{ "meta": {}, "paragraphs": [ { "type": "verse"|"chorus"|…, "lines": [ { "segments": [ { "chord", "lyrics", "pinyin" } ] } ] } ] }`
- **LM text**: Tab-separated lines `chord\tlyrics\tpinyin`, section headers `[Verse 1]`, optional `key: value` meta at the top. The LM fills the third column (pinyin).

## LM workflow

1. Run `npm run tab-to-ir -- your-song.txt` to get `your-song.ir.lm.txt`.
2. Send `your-song.ir.lm.txt` to the LM with instructions to add pinyin for each line (third column), keeping chord and lyrics unchanged.
3. Save the LM output as e.g. `your-song.ir.lm.filled.txt`.
4. Run `npm run ir-to-tab -- your-song.ir.lm.filled.txt your-song-with-pinyin.txt` to get the chord tab. (Pinyin in the IR is not yet rendered into the tab output; you can add a pinyin line in a later step or custom formatter.)

## Docs

- [ChordSheetJS](https://martijnversluis.github.io/ChordSheetJS/)
