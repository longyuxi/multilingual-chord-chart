# Timestamp pipeline: module contracts

Interface note for the children of epic `tab-pinyinizer-ilg`. Each stage owns
exactly one module and speaks only in the types from `src/timestamps/types.ts`,
so the stages stay independently replaceable and the parallel work doesn't
collide.

## Module ownership

| Module | Issue | Owns |
| --- | --- | --- |
| `src/timestamps/types.ts`, `paths.ts`, `env.ts`, `pinyin.ts`, `ecb-markers.ts` | ilg.15 | Shared contracts. Do not edit from a stage child. |
| `src/timestamps/audio.ts` | ilg.1 | `%%youtube` lookup, yt-dlp download, ffprobe duration, audio cache |
| `src/timestamps/normalize.ts` | ilg.2 | ECB → `NormalizedLyrics` (primary language, syllables, `lyricHash`) |
| `src/timestamps/providers/*.ts` | ilg.3 | `AsrProviderClient` implementations + `asr.json` caching |
| `src/timestamps/align.ts` | ilg.4 | affine-gap DP over syllables × tokens → `AlignReport` |
| `src/timestamps/ecb-timestamps.ts` | ilg.5 | Strip/insert standalone `@M:SS` marker lines |
| `src/timestamps/cli.ts` | ilg.6 | `npm run timestamps` orchestration and flags |
| `src/timestamps/check.ts` | ilg.7 | `npm run check-timestamps` offline verifier |
| `prompts/fix_timestamps.md`, `src/timestamps/repair.ts` | ilg.10 | Bounded patch pass over flagged lines |
| `src/web/MusicView.tsx`, `YoutubePlayer.tsx` | ilg.9 | Dev-only playhead highlight + jump-to-next |

`package.json` scripts (`timestamps`, `check-timestamps`) and `tsconfig.json`
are already wired; `src/**/*` is included and `src/web` stays excluded
(`tab-pinyinizer-xql`). A stage child should not need to touch either file.

## Stage boundaries

```
.ecb ──audio.ts──▶ .cache/timestamps/audio/<videoId>.mp3  (duration via ffprobe)
.ecb ──normalize.ts──▶ NormalizedLyrics { lineIndex, text, syllables, lyricHash }
                              │
                    providers/*.ts ──▶ AsrResult (cached as asr.json)
                              │
                          align.ts ──▶ AlignReport
                              │
                        repair.ts (optional, flagged lines only)
                              │
                     ecb-timestamps.ts ──▶ .ecb with standalone @M:SS lines
                              │
                          check.ts (offline, no network)
```

## Invariants

- **Timestamps are relative to the embedded video's 0:00.** Audio always comes
  from the `%%youtube` id in the same file; a separately sourced studio mp3 is
  never substituted.
- **Paid calls are cached by `(videoId, provider, model, source, lyricHash)`**
  (`paths.ts`). Re-running with unchanged lyrics must never re-bill. `--force`
  is the only way past the cache.
- **`lyricHash` covers only the matching language text**, so adding or editing a
  pinyin/translation track does not invalidate paid results.
- **Monotonic for v1.** Each lyric line is matched at most once. Arrangements
  that repeat a section more times than the file lists are *flagged*
  (`repeat-suspected`), not solved.
- **Emission is idempotent.** Markers are whole-second floored (`formatMarker`),
  previously generated standalone markers are stripped before insertion, so a
  second run on an already-timestamped file is byte-identical.
- **No stage may import from `src/web/`**; that tree is excluded from the CLI
  tsconfig. `ecb-markers.ts` is the CLI-side twin of the viewer's marker parser
  and must keep the same grammar.
- **A song without `%%youtube` is skipped with a message, exit 0** -- not an
  error. Same for an absent YouTube auto-caption track.

## Provider notes

- ElevenLabs `POST /v1/forced-alignment` (multipart `file` + `text`) is primary:
  per-character and per-word times plus per-word `loss`, Chinese supported.
  Billed at Scribe rates, US$0.22/audio-hour.
- OpenAI `whisper-1` `verbose_json` + `timestamp_granularities[]=word` is the
  independent corroboration stream (~US$0.006/min). Its *text* is not used.
- `gpt-4o-transcribe` is explicitly excluded: segment-level only, no word times.
- `youtube-auto` (ilg.11) is a free fast-fail probe, never a dependency.
