# Decisions

Decisions taken while delivering the plan, with the reason for each. Newest
last. Architecture decisions with lasting consequences also get an ADR in
`docs/architecture/decisions/`.

## 2026-09-24 — Delivery tracking lives in `docs/PLAN.md`; the design stays in `docs/plan/PLAN.md`

The design document is linked from the docs index and the ADRs; moving it
would break those links for no gain. `docs/PLAN.md` tracks the three delivery
phases and points at the design for the reasoning.

## 2026-09-24 — Versions follow SemVer from here

The CHANGELOG described a `major.minor.develop` scheme from the diffusion era.
Delivery now uses SemVer: `0.2.0` when the feature phase passes its gate,
`1.0.0` when every completion condition is met, since that is the first
release a person can rely on. The old scheme's note is removed with the
CHANGELOG rewrite.

## 2026-09-24 — Workers are the crew's pool; review uses the same pool until the reviewers return

The pool is five free models behind 9router. Four of them, including both
reviewer models, have spent their weekly allowance until 2026-09-30 11:31 UTC;
`qwen3.8-flash` is the only one answering. Waiting six days is not acceptable,
so qwen writes, and reviews are done by `crew review` on qwen plus the
conductor's own reading of every diff against its spec. A same-model review is
weaker than a cross-model one, which is why the conductor's reading is not
skipped. When the MiMo reviewers return, they take review back.

## 2026-09-24 — The reference MCP tools read stored references only

`read_reference` and `extract_palette` read what `reference_import` stored
(the conformed PNG and its report). They never call the sidecar, so the stdio
transport, which runs without the sidecar, serves them too.

## 2026-09-24 — A background is a tilemap of tile assets

Following the plan's canvas table: a tile is an ordinary asset drawn through
the normal workflow; a background asset holds a grid of tile ids in one or
more named layers, each with a parallax factor. The agent edits a tile as a
small canvas and places tiles by id, which keeps readback small. Autotile
rules are not built: the plan lists them for tilesets, but nothing in the
workflow or the tools needs them yet, and placing tiles by id covers every
background the plan describes.

## 2026-09-24 — Reviews cross model families by naming the reviewer

The pool now also holds `claude-sonnet-5` as a writer. With two families
answering, every review names a model from the other family than the one that
wrote the task (`crew review --model ...`, `crew run --role reviewer --model
...`), which gives a real second opinion without changing the pool's roles.

## 2026-09-24 — A conformed reference is stored as a PNG, not as palette slots

The document model said the conformed reference was "indexed", and the store
checked it as a slot buffer, while the import stored the PNG the sidecar
returns, so every real import was refused. A reference is imported at the
first step, before the asset has a palette to index it against, and both the
reference panel and `read_reference` need the colours. It is therefore kept
as a PNG at the asset's size; `read_reference` indexes it against the palette
when it is read.

## 2026-09-24 — Rust and multi-file tasks go to Claude subagents in the crew's worktrees

Calibration and the first waves measured it: `qwen3.8-flash` passes
TypeScript and docs probes but not Rust, and on multi-file tasks both
workers behind the router spend their step budget reading files the prompt
did not inline, then stop without writing. `claude-sonnet-5` behind the
router also hits a per-minute rate limit when several workers run at once.
So a Rust task, or one spanning several new files, is written by a Claude
subagent working in the same task worktree Agent Crew creates (with its
shared build directories), under the same file ownership, verify command
and review. Crew workers keep the small, fully specified tasks. The cost is
the same account either way: the router's Sonnet is that subscription.

## 2026-09-24 — The sprite gallery is removed

The gallery listed the PNG files in the engine's `sprites` directory, which
only the diffusion generator ever wrote to. Exports now go to a folder the
person picks or to `<data root>/exports/`, and a sprite is a document in the
store, opened from the project tree. The gallery showed a directory nothing
writes to any more, so the screen, its store, the engine's sprite routes and
the shell commands behind them are removed rather than kept as a view of
leftovers.

## 2026-09-25 — The studio layout is copied, the product is not

The user asked for the reference studio's UI and layout one to one. The
structure, spacing, type, icons and colours are reproduced exactly; the name,
branding, account, cloud, marketplace and paid-plan controls are not, because
Bitwright has none of them and a control that does nothing is not a copy of
one that does something. Each is replaced by the Bitwright feature in the
same place: the account card by the agent (MCP) card, Sign in by Connect an
agent, Marketplace and Recycle Bin by Projects and Settings, AI Create by the
Agent popover, Cloud Storage by the reference import, the avatar by Settings.

## 2026-09-25 — The bottom strip is the step workflow, not an animation timeline

The reference's bottom strip is an animation timeline. Bitwright's
equivalent sequence is its drawing workflow — eleven steps, each with a
layer, gates and an advance — and that is what the user asked to keep at the
centre. The strip shows one card per step with its layer's thumbnail, and
its bar carries check, advance, revisit and forced advance. Animation frames
remain a separate feature for a later release: they change the document
model, the store, the op log, the MCP tools and export, which is a phase of
its own rather than a layout change.

## 2026-09-25 — Tailwind's palette comes back, through variables

The theme used to remove Tailwind's palette so that every colour went
through a role token. The reference is written in Tailwind's neutral, pink,
sky and purple, and copying it one to one means using those classes. The
neutral scale reads CSS variables, so the light theme still works by
inverting it, and the role tokens stay and are re-pointed so the contrast
check keeps measuring them.

## 2026-09-25 — Phase 4 is written by Claude subagents

The router's free allowances are exhausted until 2026-09-30 and its Sonnet
is rate-limited, so the crew's model pool cannot take work. Following the
earlier decision for multi-file work, each task is written by a Claude
subagent in its own crew worktree, owns its files, passes its verify, is
reviewed by another subagent, and lands as one commit.

## 2026-09-25 — With a selection, shapes are rasterised in the editor

A selection clips every tool. `draw_shape` is rasterised by Rust and has no
mask, so while a selection exists a shape is rasterised client-side and sent
as `set_pixels`; without one it stays `draw_shape`, so the rasteriser an
agent and a person share is still Rust's.

## 2026-09-25 — A frame is an asset, an animation is a list of them

Frames could have been a new dimension of the layer table — every layer
keyed by asset, frame and role — but then every op, every gate, the op log,
undo, every MCP tool and every command would need a frame argument, and the
workflow would have to decide what a step means across frames. Making each
frame an ordinary asset and the animation an ordered list of them, the way a
background is a grid of tile assets, leaves all of that untouched: a frame is
drawn, checked and undone exactly as a sprite is. The cost is that frames
share a palette by copying it — a palette write goes to every frame in one
transaction — rather than by pointing at one row.

## 2026-09-25 — The bottom panel holds the timeline or the steps

The reference layout has one bottom strip, the timeline; Bitwright also has
its steps strip there. Two stacked strips would take a fifth of the window,
so the header has a toggle for each and the panel shows one at a time.
