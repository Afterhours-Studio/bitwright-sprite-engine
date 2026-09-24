# Phase 3 — workflow, skills and reference import, broken into tasks

This is the working breakdown of [Phase 3 in the plan](PLAN.md#phase-3--workflow-and-skills).
The rules of [§7 of the plan](PLAN.md#7-rules-of-execution) apply: parallel
tasks never share a file, a contract precedes the wave that depends on it, and a
wave passes on real build and test output. Paths are relative to
`apps/desktop/src-tauri/src/` for Rust and `apps/desktop/src/` for TypeScript.

## What Phase 1 already delivered

Task 3.1, the step state machine and gate evaluation, was built with the
document model: `store/workflow.rs` holds the steps, `raster/gates.rs` measures
every check from the pixel buffer, and Phase 2 added `step_advance_as` (forced
advances on the record) and `step_revisit`. The `StepRail` panel shows the step
and its gate. What remains of the workflow is the interface's half: moving back
a step, and a forced advance a person makes on purpose.

The plan named `routes/reference.py` for the sidecar. The existing
`/v1/conform` route already takes an image and answers with the corrected
image, its palette and the detected grid, and stores nothing, which is exactly
what import needs; no second route is written.

## The skill pack is served, not installed

The plan had an installer copying `skills/` into a client's skills folder behind
an **Install Skills** button. That reaches Claude Code only: Claude Desktop and
Cursor read no such folder. The MCP server is already connected to every
client, so it carries the manual itself: the documents are compiled into the
binary, returned by the `read_guide` tool that every client can call, and listed
as MCP resources for clients that browse them. There is no installer and no
button.

## Wave A — contract (one task)

**A.1** `Cargo.toml` gains `png = "0.17"` and `base64 = "0.22"` (both already in
the lock file through Tauri). `lib/i18n.ts` and `types/i18next.d.ts` gain two
namespaces, `workflow` and `reference`, with empty `locales/{en,vi}/workflow.json`
and `reference.json`, so the three interface tasks below each own a locale file.

## Wave B — parallel

| Task    | Owns                                                                                   | Builds                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B.1** | `raster/png.rs`, its `pub mod` line in `raster/mod.rs`                                 | `decode(&[u8]) -> RgbaImage`, `encode(&RgbaImage) -> Vec<u8>`, `index(&RgbaImage, &Palette, alpha_threshold) -> IndexedBuffer` (nearest slot per opaque pixel, 0 for transparent)     |
| **B.2** | `mcp/guide.rs`, `mcp/tools/guide.rs`, their module lines, `mcp/handler.rs`             | the skill pack served by the server itself: embedded in the binary, the `read_guide` tool, and `bitwright://guide/<topic>` MCP resources; the instructions send the agent to it first |
| **B.3** | `commands/document.rs` (two commands), `lib/document.ts`, `stores/useDocumentStore.ts` | `step_revisit(assetId, step)` and `step_advance(assetId, force)`; the store's `revisit(step)` and `advance({ force })`                                                                |

## Wave C — parallel, after Wave B

| Task    | Owns                                                                                                 | Builds                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **C.1** | `reference.rs` (new, binary crate), its `mod` line in `main.rs`                                      | import through the sidecar, store, list, read, delete; commands below                                             |
| **C.2** | `mcp/tools/reference.rs`, its line in `mcp/tools/mod.rs`                                             | `read_reference`, `extract_palette` over stored references (no sidecar call, so stdio serves them too)            |
| **C.3** | `features/editor/tools/StepRail.tsx` and its test, `locales/*/workflow.json`                         | every step listed, the current one marked; revisit an earlier step; advance; forced advance behind a confirmation |
| **C.4** | `features/editor/reference/**`, `lib/reference.ts`, `types/reference.ts`, `locales/*/reference.json` | the reference panel: import a file, preview, detected grid and warnings, delete, apply the extracted palette      |

## Wave D — integration

Registers the new commands in `commands.rs`, mounts the reference panel in
`EditorScreen.tsx`, and brings `docs/architecture/mcp-tools.md` and the README
up to date.

## The contracts

```ts
// reference (C.1 builds, C.4 uses)
reference_import(assetId: string, path: string, name?: string): ReferenceSummary
    // reads the file at path (chosen by the person in the system file dialog),
    // conforms it to the asset's size through the sidecar, stores it
reference_list(assetId: string): ReferenceSummary[]
reference_preview(assetId: string, referenceId: string): string   // data:image/png;base64,...
reference_delete(assetId: string, referenceId: string): void
interface ReferenceSummary {
  id: string; assetId: string; name: string; createdAt: number;
  width: number; height: number;          // the conformed size
  palette: string[];                      // hex, most used first
  detected: { cellWidth: number; cellHeight: number; confidence: number } | null;
  warnings: string[];                     // stable codes from conform
}

// workflow (B.3 builds, C.3 uses)
step_revisit(assetId: string, step: string): StepState
step_advance(assetId: string, force: boolean): StepState   // force records "user (forced)"
```

`read_reference { assetId?, referenceId? }` returns the most recent reference
by default: its grid in the asset's palette (nearest slot per pixel, via
`raster::png::index`), with the legend and rulers `read_canvas` uses, and the
conform report. `extract_palette { assetId?, referenceId?, maxSlots? }` groups
the stored palette into ramps by hue, each ordered darkest first, material
`custom`, and returns them as a `set_palette` body without applying it.
