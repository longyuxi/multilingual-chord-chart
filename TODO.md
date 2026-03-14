Design
- `extended chord bracket format` (.ecb) (see `format_spec/when_you_are_old.ecb` for a free language specification of this format) which down projects into the ultimate guitar format.

Plan
1. Implement the final website.
    - First, maybe refactor the format parsers into a folder.
    - This is a website that hosts chords and lyrics for my own view. The format that the website reads in is through the ECB format.
    - This website should have two pages:
        1. The first page is a catalog of all the music available, with their title and artist name.
        2. After clicking into a segment, we can see the music in free text (the Music View).
    - We will implement the exact details of Music View later. For now, let's just work on the catalog page, which will lead to a free text view of the music.


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