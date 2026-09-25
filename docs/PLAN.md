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

## Phase 3 — Finish · done

Goal: production quality: complete, consistent, documented.

| Task | What                                                                                       |
| ---- | ------------------------------------------------------------------------------------------ |
| P.1  | i18n sweep: every visible string in English and Vietnamese, no key missing in either       |
| P.2  | Test sweep: every command, tool and store action covered; the contrast check passes        |
| P.3  | README: install, configure (MCP clients, sidecar), run, build; docs brought up to date     |
| P.4  | No TODO, mock or hardcoded value left; CHANGELOG rewritten for what the application is now |

All four done: the i18n sweep found no untranslated string and no key
missing in either language; the test sweep closed every gap an audit of the
commands, tools, store methods, store actions, bridges and engine routes
found; the README and the guides were rewritten against the code and
reviewed; the audit found no TODO, mock or unexplained hardcoded value, and
the obsolete sprite gallery was removed.

Exit criteria met: the full gate green (prettier, typecheck, lint, 323 TS
tests, the contrast check, rustfmt, clippy with warnings as errors, 431 Rust
tests, 91 Python tests), everything committed, version `1.0.0` tagged with
its CHANGELOG.

## Phase 4 — Studio · done

Goal: the interface rebuilt one to one on the reference studio layout in
[architecture/studio-layout.md](architecture/studio-layout.md) — a home
screen, a header, a tools column with the full manual toolset, a floating
stage, colour and layers panels, and a bottom strip — with Bitwright's agent
workflow in it: the strip is the step workflow, the header's Agent button is
the MCP state and live agent activity, the reference import sits in the
header.

| Task | What                                                                                                | Owns                                                                                                                                                                   | Wave | Status |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| S.0  | Design system and state: palettes, tokens, font, utilities, contrast check, shell and editor stores | `tailwind.config.ts`, `styles/**`, `main.tsx`, `scripts/check-contrast.ts`, `stores/useShellStore.ts`, `stores/useEditorStore.ts`, `lib/i18n.ts`, `types/i18next.d.ts` | 0    | done   |
| S.1  | Home: sidebar, recent and projects grids, list view, sort and filter, new sprite dialog             | `features/home/**`, `locales/*/home.json`, `locales/*/projects.json`                                                                                                   | 1    | done   |
| S.2  | Editor header: every control, the agent popover, window controls                                    | `features/editor/header/**`, `components/layout/WindowControls.tsx`, `locales/*/studio.json`                                                                           | 1    | done   |
| S.3  | Tools column and keyboard shortcuts                                                                 | `features/editor/tools/ToolColumn.tsx`, `hooks/useToolShortcuts.ts`, `locales/*/tools.json`                                                                            | 1    | done   |
| S.4  | Stage: the new tools' behaviour, selection, symmetry, floating panels, tile guide                   | `features/editor/canvas/**`, `features/editor/PixelGridOverlay.tsx`, `lib/pixels.ts`, `lib/shapes.ts`, `lib/selection.ts`, `locales/*/editor.json`                     | 1    | done   |
| S.5  | Colour panel and layers panel                                                                       | `features/editor/tools/PalettePanel.tsx`, `features/editor/tools/LayerList.tsx`, `locales/*/panels.json`                                                               | 1    | done   |
| S.6  | Steps strip                                                                                         | `features/editor/tools/StepRail.tsx` and its test, `locales/*/workflow.json`                                                                                           | 1    | done   |
| S.7  | Integration: screens, shell, settings, dialogs restyled, old frame removed, docs, README, 1.1.0     | everything else                                                                                                                                                        | 2    | done   |

Exit criteria: every row done and cross-reviewed; the full gate green; the
application checked in a browser against the reference at 1440×900; README
and docs describe the new interface; version `1.1.0` tagged.

S.0 ran first, S.1–S.6 in parallel, S.7 as two parallel halves (screens and
shell; the restyled primitives and dialogs) and S.8 for the documentation.
The stage (S.4) was cross-reviewed and its seven findings fixed; the rest
were reviewed against the contract when they landed. The application was
checked in the real window with a sprite an agent drew over MCP, which is
where the README's screenshots come from.

Exit criteria met: the full gate green (prettier, typecheck, lint, 505 TS
tests, the contrast check, rustfmt, clippy with warnings as errors, 431 Rust
tests, 91 Python tests), a release build of the installer, everything
committed, version `1.1.0` tagged with its CHANGELOG.

## Phase 5 — Animation · done

Goal: animation frames, for a person and for an agent — the reference
layout's timeline (playback modes, FPS, per-frame duration, play, onion skin,
duplicate, delete, reorder, add) on top of a model where every frame is an
ordinary asset, so the workflow, the gates and every tool work on a frame
unchanged; GIF export; MCP tools and a guide page for animating. The
contract is [architecture/animation.md](architecture/animation.md).

| Task | What                                                                                         | Owns                                                                                                                           | Wave | Status |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| A.1  | Store: migration 5, frames and animation, shared palette, rename and delete rules; commands  | `store/**`, `commands/animation.rs`, command registration                                                                      | 1    | done   |
| F.1  | Frontend types, bridge and animation store                                                   | `types/animation.ts`, `types/document.ts`, `lib/animation.ts`, `stores/useAnimationStore.ts`                                   | 1    | done   |
| A.2  | MCP tools, host, guide page, tool reference                                                  | `mcp/**` except `mcp/tools/export.rs`, `docs/architecture/mcp-tools.md`, the guide sources                                     | 2    | done   |
| A.3  | GIF export, sheets of an animation, `export_gif` command and tool                            | `export.rs`, `mcp/tools/export.rs`, the export command, `Cargo.toml`                                                           | 2    | done   |
| F.2  | Timeline strip                                                                               | `features/editor/timeline/**`, `locales/*/timeline.json`                                                                       | 2    | done   |
| F.3  | Stage and frame: onion skin, playback, header toggles, bottom panel, editor screen, commands | `features/editor/canvas/**`, `features/editor/header/**`, `EditorScreen.tsx`, `stores/useEditorStore.ts`, `CommandPalette.tsx` | 2    | done   |
| F.4  | Home frame counts and the export dialog's GIF and sheet                                      | `features/home/**`, `features/editor/export/**`, `lib/export.ts`                                                               | 2    | done   |
| A.4  | Integration, end-to-end over MCP, docs, README, 1.2.0                                        | everything else                                                                                                                | 3    | done   |

Exit criteria: every row done and reviewed; the full gate green; an agent
animates a sprite end to end over MCP (frames, durations, GIF); the timeline
checked in the real window; README and docs updated; version `1.2.0` tagged.

A.1 and F.1 ran first, then A.2, A.3 and F.2–F.4 in parallel. The store (A.1)
was cross-reviewed; its eight findings were fixed in A.1b and in the MCP
tools, and a mismatch found while integrating — the GIF command replacing an
existing file — was fixed in A.4a. An agent animated a four-frame blink over
MCP stdio end to end (frames, durations, ping-pong, a GIF of six frames), and
the timeline, onion skin and playback were checked in the real window.

Exit criteria met: the full gate green (prettier, typecheck, lint, 584 TS
tests, the contrast check, the licence check, rustfmt, clippy with warnings
as errors, 502 Rust tests, 91 Python tests), a release build of the
installer, everything committed, version `1.2.0` tagged with its CHANGELOG.

## Phase 6 — Own style · done

Goal: keep the studio layout, give it back Bitwright's own look. Phase 4
copied the reference's theme and component styling along with its layout,
which the user did not ask for. The contract is
[architecture/studio-style.md](architecture/studio-style.md): role tokens,
the 1.0 type stack, radii, shadows, bezel and `components/ui`, and a mapping
from every reference class to its Bitwright equivalent.

| Task | What                                                                               | Owns                                                                                                    | Wave | Status |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---- | ------ |
| R.0  | Tokens, type, radii, shadows back to 1.0; shared components back to their 1.0 look | `styles/**`, `tailwind.config.ts`, `main.tsx`, `components/ui/**`, `package.json`                       | 0    | done   |
| R.1  | Home and settings in Bitwright's style                                             | `features/home/**`, `features/settings/**`                                                              | 1    | done   |
| R.2  | Frame: bezel, header, window controls, command palette                             | `components/layout/**`, `features/editor/header/**`, `App.tsx`                                          | 1    | done   |
| R.3  | Tools column, colour panel, layers panel                                           | `features/editor/tools/{ToolColumn,PalettePanel,LayerList}.tsx`                                         | 1    | done   |
| R.4  | Stage, tilemap stage, reference, export, agent chip                                | `features/editor/{canvas,tilemap,reference,export,live}/**`, `PixelGridOverlay.tsx`, `EditorScreen.tsx` | 1    | done   |
| R.5  | Steps strip and timeline                                                           | `features/editor/tools/StepRail.tsx`, `features/editor/timeline/**`                                     | 1    | done   |
| R.6  | The palette removed, a test that bans it, docs, 1.2.1                              | everything else                                                                                         | 2    | done   |

Exit criteria: no Tailwind palette class left in `src` (a test says so); the
contrast check green; both themes checked in the real window; the full gate
green; version `1.2.1` tagged.

R.0 restored the tokens and the shared components first; R.1–R.5 converted
their screens in parallel while a marked transitional block kept the old
palette rendering; R.6 removed it, added the test that bans it, and brought
the design-system and theming guides back. Home, the editor with the
timeline and the steps, the dialogs and settings were checked in the real
window in both themes, and the header at 1280px.

Exit criteria met: no palette class in `src`, the full gate green (prettier,
typecheck, lint, 585 TS tests, the contrast check, the licence check,
rustfmt, clippy with warnings as errors, 502 Rust tests, 91 Python tests), a
release build of the installer, version `1.2.1` tagged with its CHANGELOG.
