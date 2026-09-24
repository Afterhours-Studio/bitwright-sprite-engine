# Plan and progress

The design, its reasoning and the per-phase task tables live in
[plan/PLAN.md](plan/PLAN.md). This file tracks delivery in three phases —
foundations, features, finish — and is updated at the end of each one.
Decisions made along the way are recorded in [DECISIONS.md](DECISIONS.md).

Work is delegated to worker models through Agent Crew
(`.agent-crew/project.toml`): each task owns its files, runs in its own
worktree, must pass its verify kind before it may finish, is reviewed, and
lands on `main` as one commit. Every phase ends with the full gate, run and
read by the conductor, not taken from a worker's report:

```
npm run format:check && npm run typecheck && npm run lint && npm run test
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test   (apps/desktop/src-tauri)
python -m pytest                                                               (packages/engine)
```

## Phase 1 — Foundations · done

Goal: the indexed document, the drawing workflow's state machine and the MCP
server an agent draws through.

- Demolition of the diffusion stack; the smaller application compiles and passes.
- Document model: SQLite store, indexed raster core, op log with undo and redo,
  Tauri commands, the canvas and the tool panel.
- MCP: streamable HTTP on loopback with a token, stdio, the tool catalogue,
  client configuration, live sync with the agent-activity indicator.
- Phase 3 contract and first wave: PNG decode and encode, the drawing manual
  served by the server (`read_guide`, `bitwright://guide/*`), `step_revisit`
  and forced `step_advance`, reference import through the sidecar.

Exit criteria met: full gate green at `f278cec`.

## Phase 2 — Features · done

Goal: everything the plan promises a person or an agent can do.

| Task | What                                                                                                   | Owns                                                                                                 | Status |
| ---- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------ |
| F.1  | MCP `read_reference` and `extract_palette` over stored references                                      | `mcp/tools/reference.rs`, its line in `mcp/tools/mod.rs`                                             | done   |
| F.2  | Step rail: every step, the current one marked, revisit, advance, forced advance behind a confirmation  | `features/editor/tools/StepRail.tsx` and its test, `locales/*/workflow.json`                         | done   |
| F.3  | Reference panel: import, preview, detected grid and warnings, delete, apply the extracted palette      | `features/editor/reference/**`, `lib/reference.ts`, `types/reference.ts`, `locales/*/reference.json` | done   |
| F.4  | Mount the reference panel in the editor; document the reference tools                                  | `EditorScreen.tsx`, `docs/architecture/mcp-tools.md`                                                 | done   |
| F.5  | Tilemaps: a background is a grid of tile assets in named parallax layers; commands and MCP tools       | `raster/tilemap.rs`, `commands/tilemap.rs`, `mcp/tools/tilemap.rs`, `features/editor/tilemap/**`     | done   |
| F.6  | Export: a sprite to PNG at a scale, frames or tiles to a sheet, a tilemap flattened; folder and naming | `export.rs`, `mcp/tools/export.rs`, `features/editor/export/**`                                      | done   |

F.1–F.3 ran in parallel; F.4 followed F.3. F.5 and F.6 started from the contract
in `docs/architecture/tilemap-and-export.md`, and F.7 wired everything into
the editor.

Exit criteria met: every row done and cross-reviewed, the full gate green
(prettier, typecheck, lint, 194 TS tests, the contrast check, rustfmt,
clippy with warnings as errors, 410 Rust tests, 101 Python tests), the new
commands and tools in `docs/architecture/mcp-tools.md`, version `0.2.0`
tagged.

## Phase 3 — Finish · in progress

Goal: production quality: complete, consistent, documented.

| Task | What                                                                                       |
| ---- | ------------------------------------------------------------------------------------------ |
| P.1  | i18n sweep: every visible string in English and Vietnamese, no key missing in either       |
| P.2  | Test sweep: every command, tool and store action covered; the contrast check passes        |
| P.3  | README: install, configure (MCP clients, sidecar), run, build; docs brought up to date     |
| P.4  | No TODO, mock or hardcoded value left; CHANGELOG rewritten for what the application is now |

Exit criteria: the completion conditions — every feature in this plan, the
full gate green, no TODO, mock or hardcoded value, a README that matches the
application, everything committed, version `1.0.0` tagged with its CHANGELOG.
