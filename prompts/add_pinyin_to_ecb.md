Convert the following `.ecb` (Extended Chord Bracket) text to include Pinyin.

**Rules:**
1. Update `%%languages` to `chinese, pinyin`.
2. For every lyric segment `[Chord]Chinese`, change it to `[Chord]Chinese|pinyin`.
3. **Pinyin Formatting:**
    *   Use **no tone marks** (e.g., "dang ni" instead of "dāng nǐ").
    *   Separate the Pinyin for each individual character with a **single space**.
4. Maintain all existing chords, brackets, and section tags (`< >`).
5. Keep empty chord sequences and free text (lines starting with `>`) unchanged.
6. Wrap your output in triple backticks.

**Input:**
