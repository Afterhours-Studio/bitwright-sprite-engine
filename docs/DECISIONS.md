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
