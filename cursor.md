# Tab-pinyinizer: Cursor setup

## Best prompt on cursor.directory for this project

Use the **Optimized Next.js TypeScript Best Practices (Modern UI/UX)** rule as the main process prompt:

- **Link:** https://cursor.directory/optimized-nextjs-typescript-best-practices-modern-ui-ux  
- **Use for:** Its **methodology and process** (framework-agnostic). Ignore Next.js/React/UI specifics.
- **Why it fits:** This repo is a **data pipeline** (parse → IR → LM adds pinyin → format). The rule’s process applies well:
  1. **Deep dive** – Understand ChordSheetJS, IR format, and round-trip constraints.
  2. **Planning** – Outline flow (parser → IR serializer, IR → formatter) and data shapes.
  3. **Implementation** – Step-by-step, with guard clauses and early returns.
  4. **Review and optimize** – Edge cases (empty lines, sections, encoding).
  5. **Finalization** – Correctness and round-trip fidelity.

Apply its **code style** where relevant: functional style, descriptive names (`isChordLine`, `hasPinyin`), early returns, modularization. Skip RSC, Tailwind, and React.

**Alternative (if you prefer strict TypeScript/Node style):**  
**Node / NestJS Clean TypeScript** – https://cursor.directory/rules/node  
Use the TypeScript/function/data/RO-RO parts; ignore NestJS modules/controllers.

---

## Project context (for AI)

- **Goal:** Add pinyin (Chinese phonetic spelling) to existing Chinese song chord sheets using an LM, without the LM having to align by whitespace.
- **Pipeline:** Ultimate Guitar tab → **intermediate representation (IR)** with explicit chord–lyric segments → LM fills pinyin per segment → IR → back to chord tab (ChordSheetJS).
- **Stack:** Node.js, ChordSheetJS (parse + format). IR is segment-based: `{ chord, lyrics, pinyin? }` per segment; alignment is structural, not positional.
- **Key files:** `convert/` (in/out examples), `parse-example.js`, `check-alignment.js`. Parse with `UltimateGuitarParser`; output with `ChordsOverWordsFormatter` or equivalent.
