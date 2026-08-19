# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm install
npm run dev        # web app dev server (binds 0.0.0.0, allowedHosts set in vite.config.ts)
npm run build:web  # production build of the web app -> dist-web/ (deploy target, see vercel.json)
npm run preview    # preview a build:web output

npm run build:cli  # tsc build of the legacy CLI pipeline (src/*.ts, excl. src/web) -> dist/
```

There is no test runner, linter, or CI config in this repo — don't invent `npm test`/`npm run lint` commands. `npm run build:cli` (tsc, strict mode) is the closest thing to a correctness check for the non-web TypeScript, and `tsc -p tsconfig.web.json --noEmit` type-checks `src/web/` (no script wired up for it currently).

The legacy CLI pipeline scripts (`check-alignment`, `parse-example`, `ug-to-html`, `tab-to-ecb`) all run compiled output from `dist/`, so `npm run build:cli` must be run first for any of them to work.

## Architecture Overview

This repo is two things bolted together: a **live web viewer** (current, primary) and a **legacy CLI conversion pipeline** (deprecated, kept for one-off conversions of old Ultimate Guitar tabs).

**Web viewer** (`src/web/`, built with Vite + React + Tailwind v4):
- `songs.ts` loads every `songs/*.ecb` file as a raw string at build time via `import.meta.glob` — adding a song is just dropping a `.ecb` file in `songs/`, no registration step.
- `ecb-parser.ts` / `ecb-viewer-parser.ts` parse the ECB text format (metadata header + lyric-segment lines) into structures the UI renders.
- `MusicView.tsx` is the main song view: renders aligned chord/lyric columns per language, per-language toggles, transposition (`chord-transposer.ts`), and the optional YouTube embed.
- `CatalogPage.tsx` is the song list/landing page; `App.tsx` / `main.tsx` wire routing between catalog and song view.
- Ships to Vercel as a static build (`vercel.json` → `npm run build:web` → `dist-web/`).

**Legacy CLI pipeline** (`src/*.ts`, non-`web/`, compiled with plain `tsc` per `tsconfig.json`):
- Purpose: parse an Ultimate Guitar tab with ChordSheetJS and emit ECB directly, in one pass — `tab-to-ecb.ts` is the CLI entry point, backed by `tab-to-ecb-core.ts`'s `songToEcb()`. No intermediate tree, no JSON representation, no agent-filled-in step, no tab-to-tab roundtripping.
- `tab-to-ecb.ts` / `tab-to-ecb-core.ts` do the conversion; `check-alignment.ts`, `ug-to-html.ts`, `parse-example.ts` are the other verification/inspection steps.
- Superseded by the prompt-driven ECB workflow below for new work; only reach for this pipeline when converting an old UG-format tab.

**Song format (ECB):** `.ecb` is this project's own plain-text notation — spec and worked example in `format_spec/format_spec.ecb` and `prompts/general_spec.md`. Key shape: `%%key value` metadata lines, `<Section Title>` headers, and lyric lines made of `[Chord]lang1|lang2|...` segments, where `%%languages` in the header declares how many `|`-separated languages each segment carries and in what order.

## Conventions & Patterns

- **New songs and translations are produced by prompting an LLM agent, not by writing code.** `prompts/` holds the reusable prompt templates:
  - `general_spec.md` — the ECB format spec + worked example, used as shared context for any ECB-related prompt.
  - `add_pinyin_to_ecb.md` — turns a `chinese`-only ECB file into `chinese, pinyin`.
  - `translation_spec.md` — guides adding a translated-language track (aiming for singable, roughly syllable-matched lines).
  - When syllable-count-synchronized translation is needed, the agent should use the `count_syllables` MCP tool from the separate `lyric-translator-tools` repo (`~/workdir/lyric-translator-tools`, kept as its own repo — different toolchain (Python/uv) and independently reusable — see its README for MCP config). Don't vendor or copy that tool into this repo.
- `songs/*.ecb` is the source of truth for what's published on the site — a file only needs to be valid ECB and land in that directory to appear in the catalog. `%%languages` in each file's header must match the number of `|`-separated segments used in its lyric lines.
- `convert_workdir/` is a gitignored scratch directory for ad hoc intermediate files (e.g. `.txt`) when working with the legacy CLI pipeline — not for anything that needs to persist; don't treat files there as canonical.
- `dist/` (CLI build) and `dist-web/` (web build) are both gitignored build output, not source.
- Web app styling is Tailwind v4 utility classes inline in JSX (see `CatalogPage.tsx`, `MusicView.tsx`) — no separate stylesheet/CSS module convention beyond `index.css` for globals.
