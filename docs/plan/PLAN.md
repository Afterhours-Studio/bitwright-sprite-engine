# Bitwright — Agent-Driven Pixel Art Editor

The plan for turning Bitwright from a local diffusion sprite generator into a
pixel art editor that an AI agent draws in, one pixel at a time, over MCP.

This document is the execution spine. Every task below is sized to be handed to
one worker, and tasks inside a wave are written so that no two of them write the
same file.

---

## 1. What changed and why

Bitwright was built to generate sprites with a local diffusion model and then
repair the result. The repair step never stopped being a repair step. As
`docs/architecture/pixel-editing-plan.md` already put it: a diffusion model does
not produce pixel art, it produces an image of pixel art. The grid drifts, the
edges are soft, and a sixteen colour sprite arrives with tens of thousands of
colours that are each close to right rather than right.

So the model is removed from the drawing seat and an agent is put in it. The
agent does not post-process an image; it draws the sprite, on a real indexed
canvas, through a real tool API, one deliberate step at a time — and it can read
back exactly what it drew and correct itself.

**The pivot in one line:** local image generation is deleted; the application
becomes a pixel art editor whose canvas an MCP client can drive.

### What is deleted

Local and remote diffusion in full: backends, model download and cache, the GPU
runtime installer, remote provider configuration and credentials, and every
screen and store that fronted them. The 14.9 GB of downloaded weights and the
PyTorch runtime under the user's data root have already been removed.

### What is kept

- The whole design system, shell, titlebar, dock, command palette, toasts, i18n.
- The conform pipeline: DFT grid detection, weighted k-means palette reduction
  in Oklab, modal downsampling, alpha hardening, dithering, background removal.
  It stops being a repair step for generated images and becomes the importer for
  reference art.
- The Python sidecar itself — its handshake, loopback binding, token auth and
  packaging all work and are not worth rewriting.

---

## 2. Architecture

```
┌─ MCP client (Claude Code, Claude Desktop, Cursor) ─┐
│                                                     │
│   stdio  ──────────┐            ┌────── streamable HTTP (127.0.0.1)
└────────────────────┼────────────┼───────────────────┘
                     ▼            ▼
        ┌──────────────────────────────────────┐
        │  Tauri app (Rust)                    │
        │                                      │
        │   rmcp server ──► document store ────┼──► SQLite
        │        │              │              │
        │        │              ├─ raster ops  │
        │        │              └─ op log      │
        │        ▼                             │
        │   tauri emit ──► React renderer      │
        └────────────────┬─────────────────────┘
                         │ HTTP + token (existing)
                         ▼
        ┌──────────────────────────────────────┐
        │  Python sidecar (slimmed)            │
        │   conform · palette extract · export │
        └──────────────────────────────────────┘
```

**Rust owns interactive state.** The document, the layers, the op log and the
MCP server all live in the same process as the window, so an agent's draw call
reaches the canvas as a direct event emit with no network hop in the hot loop.

**Python owns batch image maths.** Conform, palette extraction from a reference
image, and sheet export. Called rarely, per user action, never per draw call.

**Two transports, chosen in Settings.** HTTP Local is the primary: the app is
running, the agent connects to it, and the user watches the sprite appear. Stdio
exists for headless and CI use and runs the same binary with `--mcp-stdio`.

### Why Rust for MCP rather than the Python sidecar

The draw loop is state mutation, not computation, and it must reach the window
immediately. Putting it in the sidecar would mean every `draw_run` crossed a
process boundary and came back as an event the Rust side then re-emitted. `rmcp`
is the official Rust SDK and carries both transports we need.

### Why the sidecar survives at all

Conform is numpy work — a DFT over every pixel and a k-means in Oklab — that is
written, tested and correct. Porting it buys nothing and risks the one part of
the old pipeline that was always worth keeping.

---

## 3. The canvas, and how an agent draws on it

### Indexed, not RGBA

A document's pixels are palette indices, one byte each, not colours. The agent
picks slot 4, not `#7A4B2E`. This is what makes readback cheap, recolouring
free, and palette discipline enforceable rather than advisory.

### Readback is text, with a ruler

A 64×64 layer reads back as 64 lines of 64 characters — about 4 KB. That is
nothing to a model, and it is the single feature that lets an agent see what it
actually drew instead of drawing blind. Every readback carries column and row
rulers, because a model counting unaided to column 37 on row 41 will miss.

```
      0    5    10   15   20   25   30
 40 | ..........AAAAAAAAAA...........
 41 | ........AABBBBBBBBBBAA.........
 42 | ......AABBBCCCCCCBBBBBAA.......
```

`.` is transparent; `A`–`Z`, then `a`–`z`, are palette slots in order.

### Writing, at whatever granularity suits

Whole-grid paste, run-length rows, individual pixels, and shape primitives are
all first class. An agent laying down a silhouette pastes a grid; an agent
fixing three stray pixels sends three pixels. Neither is made to pretend to be
the other.

### Where the engine decides, not the agent

Shading colours are computed, not chosen. The agent says _this region takes core
shadow, light from the upper left_; the engine resolves which palette ramp step
that is. Letting a model pick hex values by hand is where AI pixel art turns
muddy, and it is the single biggest lever on output quality.

### Layers are the workflow steps

`silhouette · outline · shadow-core · shadow-deep · light · rim · detail ·
accent`. Each step writes its own layer, so revising step three does not destroy
step six, and the step gate can check one layer in isolation.

### Backgrounds are tilemaps, not giant canvases

A 320×180 background is 57,600 characters per readback. Built as a tilemap it is
a 20×12 grid of tile ids — 240 characters, and the agent edits any single tile
as an ordinary 32×32 canvas. This is also how the art is actually made.

Canvas size follows the asset type:

| Asset type | Canvas          | Drawn as                        |
| ---------- | --------------- | ------------------------------- |
| Character  | 48–64           | full grid                       |
| Prop, item | 16–32           | full grid                       |
| Tile       | 16 or 32        | full grid, edge-match checks    |
| Tileset    | N tiles         | per tile, plus autotile rules   |
| Background | tilemap ≥ 20×12 | tile placement, parallax layers |

`read_region(x, y, w, h)` exists for every canvas, so a large one is always
inspectable in pieces.

---

## 4. The drawing workflow

An asset moves through ordered steps. The agent cannot skip one, and cannot
advance until the current step passes its gate.

```
  reference ─► palette ─► silhouette ─► flats ─► shadow ─► light
                                                             │
     variation ◄─ cleanup ◄─ accent ◄─ detail ◄─ outline ◄────┘
```

| Step       | Produces                       | Gate                                        |
| ---------- | ------------------------------ | ------------------------------------------- |
| reference  | optional ref image, conformed  | none                                        |
| palette    | ramps per material             | ≥ 3 steps per ramp, hue shift present       |
| silhouette | filled mask                    | single connected region, reads at 1× scale  |
| flats      | each material's base slot      | no pixel of the mask left unassigned        |
| shadow     | core and deep shadow           | one consistent light direction              |
| light      | lit planes                     | no pillow shading, no banding               |
| outline    | outline layer                  | no outline pixel outside the silhouette     |
| detail     | interior features              | no isolated single-pixel noise above budget |
| accent     | rim and highest-contrast marks | rim coverage and accent count within budget |
| cleanup    | anti-aliased edges, no speckle | noise below budget, outer edge untouched    |
| variation  | recolours preserving value     | value structure unchanged                   |

The gates are computed from the pixel buffer, not asserted by the agent.

Two positions in that order are worth defending, because the intuitive order is
the wrong one. **Flats are their own step**, not part of the silhouette: the
silhouette answers "what shape" in a single slot, the flats answer "made of
what", and revising the material map after shading means redoing every shaded
pixel. **The outline comes late**, after the fills it borders exist, because an
outline's colour is derived from the fill beside it — outline first and the
agent has nothing to derive from, so it reaches for black, which is the most
recognisable tell of amateur pixel art. The full argument is in
[the style guide](../pixel-art/hd2d-style-guide.md).

---

## 5. Data model

```
project ──┬── style        (palette rules, canvas defaults, HD-2D preset)
          └── asset ───┬── document ──┬── palette (slots, ramps, materials)
                       │              ├── layer[]  (indexed buffer per step)
                       │              └── frame[]  (animation, later)
                       ├── reference[] (imported images + extracted palette)
                       └── step_state  (current step, gate results)

op_log ── every mutation, ordered, replayable
```

Everything lives in one SQLite file under the user's data root. Saving is
implicit and continuous — the document _is_ the database row. Exporting to PNG
is a separate, explicit action with a folder picker, exactly as a user expects
"Save As" to behave and nothing like it expects "Save" to behave.

The op log gives undo, redo, replay, and a record of which agent drew what.

---

## 6. Phases

Each phase ends with a hard gate: the build is clean, the tests pass, and the
reviewers found nothing outstanding. No phase begins before the previous one
passes.

### Phase 0 — Demolition and foundations

Remove diffusion entirely and leave a compiling, passing, smaller application.

| Task    | Scope                                                                                                                                                                                                                                                                    | Owns                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **0.1** | Delete Python diffusion: `backends/`, `models/`, `runtime/`, `providers/`, `pipeline/generator.py`, `camera.py`, `styles.py`, their routes, schemas and tests. Rewire `api/state.py`, `api/server.py`, `routes/__init__.py`. Drop `keyring` and the `cuda`/`mps` extras. | `packages/engine/**`                           |
| **0.2** | Delete generation UI: generate screen, parameter panel, preview rail, provider/runtime/engine settings cards, engine status, and their stores and hooks. Rewire `App.tsx`, tabs, command palette entries, locale files.                                                  | `apps/desktop/src/**`                          |
| **0.3** | Delete Rust runtime/model/provider commands; keep sidecar spawn, preferences, window controls.                                                                                                                                                                           | `apps/desktop/src-tauri/src/**`                |
| **0.4** | Rewrite `docs/index.md`, retire the diffusion guides and ADRs, add ADR-0012 (pivot) and ADR-0013 (Rust MCP, sidecar survives).                                                                                                                                           | `docs/**` except `docs/plan`, `docs/pixel-art` |

0.1 through 0.4 run in parallel; they share no file.

### Phase 1 — Document model and canvas

| Task    | Scope                                                                                    | Owns                                                                                       |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **1.0** | Write the schema and IPC contract both sides code against. Blocks the rest of the phase. | `docs/architecture/document-model.md`                                                      |
| **1.1** | SQLite store: migrations, project/style/asset/document CRUD, op log.                     | `src-tauri/src/store/**`                                                                   |
| **1.2** | Raster core: indexed buffers, layers, composite, the op set, gate computations.          | `src-tauri/src/raster/**`                                                                  |
| **1.3** | Tauri commands exposing 1.1 and 1.2, plus change events.                                 | `src-tauri/src/commands/document.rs`                                                       |
| **1.4** | TS types and stores for project, asset, document, layer, palette.                        | `src/types/document.ts`, `src/stores/useDocumentStore.ts`, `src/stores/useProjectStore.ts` |
| **1.5** | Project sidebar: tree, create, rename, delete, select.                                   | `src/features/projects/**`                                                                 |
| **1.6** | Canvas: indexed rendering, layer compositing, zoom, pan, grid overlay, paint tools.      | `src/features/editor/canvas/**`                                                            |
| **1.7** | Right-hand tool panel and palette editor.                                                | `src/features/editor/tools/**`                                                             |

1.1–1.3 are Rust and sequential within themselves; 1.4–1.7 are TS and parallel
once 1.0 lands.

### Phase 2 — MCP

| Task    | Scope                                                                                                                                | Owns                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **2.0** | Write the tool catalogue: every MCP tool, its schema, its errors. Blocks the phase.                                                  | `docs/architecture/mcp-tools.md` |
| **2.1** | `rmcp` server, streamable HTTP transport, loopback bind, token, session lifecycle.                                                   | `src-tauri/src/mcp/server.rs`    |
| **2.2** | Stdio transport via `--mcp-stdio`.                                                                                                   | `src-tauri/src/mcp/stdio.rs`     |
| **2.3** | Tool implementations over the Phase 1 store and raster core.                                                                         | `src-tauri/src/mcp/tools/**`     |
| **2.4** | Client detection and config writing for Claude Code, Claude Desktop, Cursor; register and unregister.                                | `src-tauri/src/mcp/clients.rs`   |
| **2.5** | Settings UI: transport picker, port, session status, Configure All Detected Clients, per-client rows, manual config, Install Skills. | `src/features/settings/mcp/**`   |
| **2.6** | Live sync: MCP mutation to renderer, throttled, with an agent-activity indicator.                                                    | `src/features/editor/live/**`    |

### Phase 3 — Workflow and skills

| Task    | Scope                                                              | Owns                                                                          |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **3.1** | Step state machine and gate evaluation.                            | `src-tauri/src/workflow/**`                                                   |
| **3.2** | HD-2D skill pack, and the installer behind Install Skills.         | `skills/**`, `src-tauri/src/mcp/skills.rs`                                    |
| **3.3** | Reference import: conform through the sidecar, palette extraction. | `src/features/editor/reference/**`, `packages/engine/.../routes/reference.py` |
| **3.4** | Workflow UI: step rail, gate results, advance and revisit.         | `src/features/editor/workflow/**`                                             |

### Phase 4 — Assets, export, polish

| Task    | Scope                                                   | Owns                                                                |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| **4.1** | Tile, tileset, tilemap and parallax background support. | `src-tauri/src/raster/tilemap.rs`, `src/features/editor/tilemap/**` |
| **4.2** | Export: PNG, sheet, folder picker, naming.              | `src-tauri/src/export.rs`, `src/features/editor/export/**`          |
| **4.3** | i18n sweep, English and Vietnamese.                     | `src/locales/**`                                                    |
| **4.4** | README, docs, screenshots.                              | `README.md`, `docs/**`                                              |
| **4.5** | Test sweep and contrast check.                          | `**/*.test.ts`, `**/*.test.tsx`, `packages/engine/tests/**`         |

---

## 7. Rules of execution

**Parallel tasks never share a file.** The Owns column is the contract. A worker
that needs to change a file it does not own stops and says so instead of
reaching across.

**A contract task precedes the wave that depends on it.** 1.0 and 2.0 exist so
that Rust and TypeScript can be written at the same time against the same
agreed shape.

**Review is adversarial and mutual.** Every task is reviewed by a worker that
did not write it. Findings are fixed and re-reviewed until clean.

**Reports are not evidence.** Each phase gate is a real `npm run typecheck`,
`npm run lint`, `npm run test`, `cargo build`, `cargo test` and `pytest`, run
and read. A phase passes when the commands pass, not when a worker says so.

**Done means done.** No TODO, no mock standing in for a feature, no hardcoded
value pretending to be configuration, and a README that matches what the
application actually does.
