Design
- `extended chord bracket format` (.ecb) (see `format_spec/when_you_are_old.ecb` for a free language specification of this format) which down projects into the ultimate guitar format.

Plan
1. Implement the final website.
    - This website should have two pages:
        1. The first page is a catalog of all the music available, with their title and artist name.
        2. After clicking into a segment, we can see the music in free text (the Music View).
            - Visualize each part of the ECB file like this:
                - Comments (starting with a single percentage sign and a space) should not be visualized.
                - Config specifications (starting with two percentage signs with the key following) should be visualized in a table. Each specification should be seen as a column of that table, with the key in the top row and the value in the bottom row.
                - Literal lines (lines that start with `>`) should be formatted just like regular text.
                - Empty lines should be preserved.
                - Section titles should be bolded and indented a little to the right.
                - All parts of a non-empty lyric segment should be left aligned to each other. A way I have thought to accomplish this is to just have a table with empty boundaries for each lyric segment.
                - For lyric segments with empty chords, the space of the chord should still be reserved so that this lyric segment will be aligned with the other lyric segments on the same line.
                - For lyric segments with empty lyrics, the space of the empty lyrics should also be reserved.


Other thoughts (just a scratch pad):
3. A website to host these
    - Or just use a chinese font with a known em size. Easy enough.
        - Need to include features:
            - Allowing to transpose
            - Maybe allow over zoom
            - Keep a persistent numbering of the songs (maybe I should specify this at the top of an ECB file as a configuration parameter.)

2. Maybe have a converter of this format into the ultimate guitar format.
    - Probably not that important since I will be using my own website after this is done anyway.


Distant ideas, probably not that important:
1. An OCR system that OCR's a Muse 2.7 sheet and produces lyrics and chords