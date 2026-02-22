# Tab-pinyinizer

Add pinyin (Chinese phonetic spelling) to existing Chinese song chord sheets using an LM. The LM works on an **intermediate representation (IR)** where chord–lyric alignment is explicit, so it doesn’t need to get whitespace right.

## Pipeline

1. **Tab → IR** – Parse Ultimate Guitar tab with ChordSheetJS, emit IR (JSON).
2. **Agent** – Edit the JSON: fill the `pinyin` field for each segment (e.g. with an agentic LM).
3. **IR → Tab** – Convert IR back to chord tab (ChordSheetJS `ChordsOverWordsFormatter`).

## Setup

```bash
npm install
npm run build
```

The project is TypeScript; source is in `src/`, compiled output in `dist/`. Use `npm run build` after changes for easier debugging (source maps and types).

## Usage

### Tab → IR (JSON)

```bash
npm run tab-to-ir -- convert/jrayty-in.txt
# Writes convert/jrayty-in.ir.json

npm run tab-to-ir -- convert/jrayty-in.txt out.ir.json
# Writes out.ir.json
```

### IR → Tab

```bash
npm run ir-to-tab -- convert/jrayty-in.ir.json
# Writes convert/jrayty-in.txt (overwrites; use a different name to be safe)

npm run ir-to-tab -- convert/jrayty-in.ir.json converted.txt
# Writes converted.txt
```

### Round-trip (sanity check)

```bash
npm run roundtrip -- convert/jrayty-in.txt convert/jrayty-roundtrip.txt
# Parses tab → IR → tab and writes convert/jrayty-roundtrip.txt
```

## IR format (JSON)

`{ "meta": {}, "paragraphs": [ { "type": "verse"|"chorus"|…, "lines": [ { "segments": [ { "chord", "lyrics", "pinyin" } ] } ] } ] }`  
Full specification: [docs/ir-json-spec.md](docs/ir-json-spec.md)

## Agent workflow

1. Run `npm run tab-to-ir -- your-song.txt` to get `your-song.ir.json`.
2. Have your agent edit the JSON: set the `pinyin` field for each segment in `paragraphs[].lines[].segments[]`, leaving `chord` and `lyrics` unchanged.
3. Run `npm run ir-to-tab -- your-song.ir.json your-song-with-pinyin.txt` to get the chord tab. (Pinyin in the IR is not yet rendered into the tab output; you can add a pinyin line in a later step or custom formatter.)

## Docs

- [IR JSON specification](docs/ir-json-spec.md)
- [Fixed-width rendering (CJK alignment)](docs/fixed-width-rendering.md)
- [ChordSheetJS](https://martijnversluis.github.io/ChordSheetJS/)
