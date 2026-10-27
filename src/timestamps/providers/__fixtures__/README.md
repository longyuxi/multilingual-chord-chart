# Provider response fixtures (tab-pinyinizer-ilg.3)

Recorded-shape payloads for the two cloud timing providers, so the response
mappers (`mapElevenLabsResponse`, `mapWhisperResponse`) can be exercised with no
API key, no upload and no spend.

- `elevenlabs-forced-alignment.json` — `POST /v1/forced-alignment` body: per
  character and per word `text` / `start` / `end` / `loss`. Includes a
  punctuation character (kept times, no syllables) and a newline with null times,
  both of which must be dropped.
- `elevenlabs-forced-alignment-latin.json` — the same body for an English lyric
  (`songs/vincent.ecb`). Its character stream is one token per letter, which can
  never match a lyric word, so the mapper must take the word stream instead.
- `whisper-verbose-json.json` — `POST /v1/audio/transcriptions` body for
  `whisper-1` with `response_format=verbose_json` and
  `timestamp_granularities[]=word`. Multi-character Chinese words, one word with
  a leading space, one punctuation-only word.

The payloads are hand-built from the documented response shapes: no live call has
been made yet, because the keys are provisioned by a human on
tab-pinyinizer-ilg.14. Re-record them from the first real call and re-run the
mappers; the mappers tolerate missing or null fields rather than assuming the
exact shape, so drift shows up as changed token lists, not a crash.
