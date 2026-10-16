# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.



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
  - `translation_spec.md` — guides adding a translated-language track (aiming for singable, roughly syllable-matched lines) by hand/eyeballing.
  - When you already have a table of translated lines that need *mechanical*, deterministic syllable-count-synced insertion into an existing `.ecb` file (rather than hand/eyeballed translation), use the `add-syllable-matched-translation` skill (`.claude/skills/add-syllable-matched-translation/SKILL.md`) instead — it drives `src/ecb-syllable-matcher.ts`, which does the character-alignment and syllable-distribution math deterministically.
  - Both paths lean on syllable-counting logic from the separate `lyric-translator-tools` repo (`~/workdir/lyric-translator-tools`, kept as its own repo — different toolchain (Python/uv) and independently reusable): the interactive `count_syllables` MCP tool for ad hoc/manual checking (see its README for MCP config), and its `syllable_tools/C_cli.py` subprocess CLI for the deterministic skill above. Don't vendor or copy that tool into this repo.
- `songs/*.ecb` is the source of truth for what's published on the site — a file only needs to be valid ECB and land in that directory to appear in the catalog. `%%languages` in each file's header must match the number of `|`-separated segments used in its lyric lines.
- `convert_workdir/` is a gitignored scratch directory for ad hoc intermediate files (e.g. `.txt`) when working with the legacy CLI pipeline — not for anything that needs to persist; don't treat files there as canonical.
- `dist/` (CLI build) and `dist-web/` (web build) are both gitignored build output, not source.
- Web app styling is Tailwind v4 utility classes inline in JSX (see `CatalogPage.tsx`, `MusicView.tsx`) — no separate stylesheet/CSS module convention beyond `index.css` for globals.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
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
- **Team-maintainer (active in this repo)**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

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
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Generic Conventions

Merged from `project-bootstrap/GENERIC_CONVENTIONS.md`.

### Agent Context Profiles

This repo's active tier is **team-maintainer** — declared here in writing
(bd has no profile setting; this statement is the opt-in): agents may close beads, run quality gates, commit,
`bd dolt push`, and `git push` as routine work. Tier definitions live in the
Agent Context Profiles section of the beads block above. A current explicit
"do not commit"/"do not push" instruction still wins. Don't use
`bd config set no-push true` to withhold push — it collapses guidance back to
conservative; state a push override here in prose instead.

### Agent Behavior

- **Spawn sub-agents freely**: Use sub-agents to offload research, search, or
  parallel work — keeps the main context lean for long-running tasks.
- **Claim before starting work**: The instant an agent begins working a
  specific bd issue — whether the user asked for it directly, or it was
  handed to a spawned sub-agent — its first action is
  `bd update <id> --claim`, before reading code or entering a worktree. Do
  this even for a quick, direct ask; small/direct tasks are the easiest to
  dive into and forget to mark as in-progress.
- **Default to a worktree for code changes**: When about to implement a code
  change directly — and the task isn't already inside a worktree, and isn't
  already covered by a skill with its own worktree flow — enter a worktree
  before editing any files. Implement the change, run relevant quality gates
  inside the worktree, and commit there per this repo's commit policy. Then:
  1. Return to the main branch's working directory, keeping the
     branch/worktree on disk.
  2. Merge locally (`git merge --no-ff <branch>`) from the main branch.
  3. Clean up once merged: remove the worktree and delete the branch.

  This keeps the main working tree stable while a change is in progress, and
  gives an easy rollback (just delete the branch) if the change doesn't pan
  out. Push authority is unaffected by this — merge locally, but push stays
  governed by whichever Agent Context Profile tier is active.

  Skip this for trivial single-file doc/config tweaks where the isolation
  overhead isn't worth it.

- **Concurrent sub-agent worktree workflow**: When a parent agent spawns
  multiple sub-agents concurrently, each owning a separate bd issue and
  worktree, the parent — not each sub-agent — does the eventual merge:
  1. **Claim first** per the rule above.
  2. **Enter a worktree** and record its location on the issue so the parent
     can find it later: `bd update <id> --set-metadata worktree=<path>
     --set-metadata branch=<branch>`.
  3. **Implement, test, commit** inside the worktree as usual.
  4. **On finishing, do not close the issue.** Label it instead:
     `bd update <id> --add-label needs-merge`, leaving status as
     `in_progress` — closing early would prematurely unblock anything that
     depends on it.
  5. **The parent discovers finished work** via
     `bd list --label needs-merge --status in_progress`, then merges it using
     the local-merge flow above.
  6. **Closing is part of the merge step, not a follow-up**: immediately
     after a successful merge, close the issue and remove the `needs-merge`
     label in that same step — easy to forget once the merge/cleanup is done.

### Main Function & CLI Policy

- **Prefer CLI arguments for repeatable/agent-run scripts/programs**: for
  anything invoked repeatedly with varying parameters — pipeline stages,
  validation entry points, anything meant to be re-run non-interactively by
  an agent — expose those parameters as CLI flags/args, with today's
  hardcoded values as the defaults, so invoking with no arguments behaves
  identically to before.
- **Scratchpad style is fine for genuine one-offs**: a script/entry point
  that's truly a one-off exploration tool, not meant to be re-run with
  different parameters as part of a workflow, can keep hand-edited
  constants/variables instead.
- Regardless of entry-point style, implement configurable behavior as
  parameters to the underlying logic, not by branching on globals.

### Citing Rationale Sources in Code

Reserve citations for decisions a future agent would otherwise have to
rediscover or could get wrong by guessing — not for glue code,
straightforward implementations, or anything the code already makes obvious.
One citation per decision, placed in the docstring/comment nearest the code
that embodies it.

Two distinct sources, different citation form for each:

- **bd issue** — cite its ID inline and state what it did, why, and what it
  superseded if it replaced an earlier approach. If a later issue superseded
  an earlier one, cite the surviving/superseding issue where the code now
  lives — don't cite a dead approach's issue as if it were still current.

  ```
  # myproject-sgx.1: LLM usage/runtime stats are aggregated into a single
  # directory per batch run, replacing myproject-707.3's per-item files
  # (one write per item made cost analysis across a batch require re-reading
  # hundreds of small files).
  ```

- **Design-doc/KB doc** — when the rationale is architectural and already
  lives in a design knowledge base rather than in a bd issue, cite by section
  heading text, not line number, since such docs can get rewritten and line
  numbers drift.

Don't invent or correlate a bd issue/doc section that isn't real — if you
can't confidently place a citation, skip it and say so rather than guessing.

### Git Commit Message Convention

Append the bd issue ID that caused the commit, in parentheses, at the end of
the commit title:

```
Add checkpoint/resume mechanism to the ingestion loop (myproject-03a)
Simplify per-cohort table naming (myproject-30g.4)
```

- **Merge commits**: `Merge <issue-id>: <summary>`.
- **Multiple issues in one commit**: list all IDs in the body rather than the
  title, e.g. a trailing line `myproject-30g.2, myproject-30g.3`.
- **Alternative**: a body line `Closes <issue-id>.` is acceptable in place of
  the parenthesized title suffix when the title is already at its natural
  length.

### Human-Needed Issues

Use bd's built-in `human` label (`bd human list/respond/dismiss/stats`) for
issues that a human, not an agent, must act on. Tag a bd issue `human`
(`bd label add <id> human`, or `bd create ... --labels=human`) whenever it
falls into one of these categories:

- **Needs human review** — an agent produced a change or output whose
  correctness or acceptability the agent cannot self-certify and that
  requires a human decision before it's final.
- **To-do for the human** — work an agent identified but that is explicitly
  out of scope for agents in this repo (e.g. a system-level software install
  that's outside the agent's permitted scope, or a deliberately
  human-scheduled regeneration of some artifact).
- **Requires discussion** — an ambiguity, contradiction, or judgment call
  surfaced mid-task that shouldn't be silently resolved by the agent.

Always pair the label with `bd update <id> --notes="..."` (or a clear
description) stating what decision or review is actually needed — a bare
label with no context is not actionable.

### Logging Principle

Use the language's standard logging facility, not ad-hoc print/console
statements, for diagnostic or informational output in anything beyond a
genuine one-off scratch script. Namespace loggers per module/file rather than
using a single global logger, so output can be filtered/attributed. If a
script's output might be consumed by both an interactive human (real TTY)
and a non-interactive agent/CI pipe, prefer plain, markup-free formatting
when there's no real TTY, since rich/ANSI styling renders as noisy raw text
when piped. See the relevant `languages/` file for a concrete implementation
of this (e.g. Python's `logging` module conventions).
