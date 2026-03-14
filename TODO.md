Design
- `extended chord bracket format` (.ecb) (see `format_spec/when_you_are_old.ecb` for a free language specification of this format) which down projects into the ultimate guitar format.

Plan
1. Implement the final website.
    - First, perhaps refactor the format parsers into a folder.
    - Make it on Figma.
    - Implement based on the Figma design.


Other thoughts (don't implement these):
I want to build a website that hosts these things.

1. An OCR system that OCR's a Muse 2.7 sheet and produces lyrics and chords
2. An intermediate format to notate pinyin (already done)
3. A website to host these
    - Need to use some css bbox alignment
    - Or just use a chinese font with a known em size. Easy enough.
        - Need to include features:
            - Allowing to transpose
        - Main extra feature:
            - I have more control over it
            - Allow me to notate song names in both English and Chinese
            - Keep a persistent numbering of the songs