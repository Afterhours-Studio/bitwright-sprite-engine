# Style presets: era x view

Today a project picks one `StylePreset` (`hd2d | snes | gameboy | custom`), and
`StyleRules::preset` (`raster/palette.rs`) expands it from one default:

| Preset           | maxSlots | rampSteps | outline   | canvas  |
| ---------------- | -------- | --------- | --------- | ------- |
| `hd2d`, `custom` | 24       | 3-5       | selective | 48 x 64 |
| `snes`           | 16       | 3-5       | selective | 48 x 64 |
| `gameboy`        | 4        | 2-4       | full      | 48 x 64 |

All share light `upper-left`. Gates read `maxSlots`, `rampSteps` and `outline`
from the rules; every other threshold is `gates::HD2D`. Canvas is one size for
every kind.

Users think in "16-bit top-down", not console names, so the preset splits
into two axes chosen separately.

## Axis 1: era (rules about colour and outline)

| Era      | maxSlots | rampSteps | outline   | Source                          |
| -------- | -------- | --------- | --------- | ------------------------------- |
| `8bit`   | 4        | 2-4       | full      | today's `gameboy`               |
| `16bit`  | 16       | 3-5       | selective | today's `snes`                  |
| `32bit`  | 24       | 3-5       | selective | today's `hd2d` (the default)    |
| `custom` | 24       | 3-5       | selective | starts as `32bit`, rules editable |

The era owns the hardware-flavoured limits. `32bit` takes HD-2D's numbers,
which style guide §2.1 already sets at 24 slots (`snes` at 16).

## Axis 2: view (rules about shape and size)

| View       | light        | Proportions guidance for the agent                                                                  |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `topdown`  | `upper-left` | 3/4 overhead. Taller than wide (about 3:4). Feet contact row at `H-3`. Four or eight facings.        |
| `sideview` | `upper-left` | Profile facing right. Squarer (about 1:1). Feet on the bottom row band. Flip the sprite for left.   |

The view owns the default canvas per kind and the agent's proportions
guidance. Gates do not change by view.

**Isometric is deferred.** The tilemap is a rectangular grid and no gate
measures a 2:1 diamond. Add it once the tilemap has diamond cells.

### Default canvas per kind (era x view)

Characters follow style guide §1.2 (`snes` 32 x 48, `hd2d-field` 48 x 64);
the rest are new numbers.

| Era    | View     | character | prop    | tile    | background |
| ------ | -------- | --------- | ------- | ------- | ---------- |
| 8bit   | topdown  | 16 x 16   | 16 x 16 | 8 x 8   | 160 x 144  |
| 8bit   | sideview | 16 x 16   | 16 x 16 | 8 x 8   | 160 x 144  |
| 16bit  | topdown  | 32 x 48   | 32 x 32 | 16 x 16 | 256 x 224  |
| 16bit  | sideview | 32 x 32   | 32 x 32 | 16 x 16 | 256 x 224  |
| 32bit  | topdown  | 48 x 64   | 48 x 48 | 32 x 32 | 320 x 240  |
| 32bit  | sideview | 48 x 48   | 48 x 48 | 32 x 32 | 320 x 240  |

`tileset` uses `tile`; `custom` uses `32bit`; a missing kind falls back to `canvas`.

## Data model

- **Rust store.** Migration 6 adds `era TEXT NOT NULL` and
  `view TEXT NOT NULL` to `style`, then backfills them from `preset`. It
  rebuilds the table to drop `preset`. `StyleRules` gains
  `canvasByKind: { [kind]: Canvas }`, with serde default empty. `canvas` stays
  as the fallback. `StyleRules::preset(p)` becomes
  `StyleRules::for_style(era, view)`. Unknown values give
  `style.invalid_era` or `style.invalid_view`.
- **Existing projects.** The `rules` JSON is not touched, so no gate result
  changes:
  - `hd2d` becomes `32bit`/`topdown`.
  - `snes` becomes `16bit`/`topdown`.
  - `gameboy` becomes `8bit`/`topdown`.
  - `custom` becomes `custom`/`topdown`.

  The style guide is an overworld (top-down) guide.
- **TS types.** Replace `StylePreset` with `StyleEra` and `StyleView`, plus
  `STYLE_ERAS`, `STYLE_VIEWS`, `DEFAULT_ERA = '32bit'` and
  `DEFAULT_VIEW = 'topdown'`. `Style` gains `era` and `view` and loses `preset`.
  `PRESET_CANVAS` becomes `styleCanvas(era, view, kind)`, which mirrors the
  Rust table. `projectCreate(name, era, view)`.
- **MCP.** `create_project` takes `{ name, era?, view? }` (defaults `32bit`,
  `topdown`). For one release it also accepts a legacy `preset`, mapped as
  above. `list_projects` returns `style: { era, view }`. `create_asset` without
  a size uses `canvasByKind[kind]`. `get_style_rules` includes `era`, `view` and
  the view's guidance line.
- **Guide text.** `mcp-tools.md` §4, `document-model.md` and the skill's
  `recipes.md`, `workflow.md`, `palette.md` say "`32bit` era" for "`hd2d`
  preset". The skill gets a paragraph per view on proportions.

## UI

- **New project dialog** (`NameDialogs.tsx`): two Selects, Era and View, each
  with a hint naming what it sets.
- **Home chip:** "16-bit · Top-down" (`presets.*` becomes `eras.*` and
  `views.*`). The palette panel shows the same text.
- **Home style filter:** one Select grouped into "Era" and "View". Picking a
  value keeps the projects that match on that axis. The store keeps
  `styles: Record<id, {era, view}>` instead of `presets`.
- **New sprite dialog:** the marked size comes from
  `styleCanvas(era, view, kind)`, and it updates when the kind changes.

## Packs (disjoint file ownership)

**A. Rust store and migration.** Owns `store/migrations.rs`, `store/schema.sql`,
`store/models.rs`, `store/mod.rs`, `raster/palette.rs` (`StyleRules`,
`for_style`, `canvasByKind`), `commands/document.rs`, and the
`project_create` test call sites in `src-tauri` outside `mcp/`.
*Done when:* a v5 database with one project of each preset migrates to v6 with
the pairs above and byte-identical `rules`. `for_style` returns the table
values for all 8 pairs. `cargo test` passes.

**B. MCP tools and guide.** Owns `mcp/tools/*.rs`, `docs/architecture/*.md` and
`skills/bitwright-pixel-art/**`. It depends on A's `for_style` signature.
*Done when:*
- `create_project` accepts `era` and `view`, and maps a legacy `preset`.
- `create_asset` sizes by kind. A test covers `8bit`/`topdown` with a `tile`
  giving 8 x 8.
- `list_projects` and `get_style_rules` expose `era` and `view`.
- No doc or skill names `hd2d`/`snes`/`gameboy` as a preset, except the
  migration note.
- `cargo test` passes.

**C. TS types, UI and locales.** Owns `src/types/document.ts`,
`src/lib/document.ts`, `src/stores/useProjectStore.ts`, `features/home/**`,
`features/editor/tools/PalettePanel.tsx`, `locales/{en,vi}/*.json`, and their
tests.
*Done when:*
- The new project dialog sends `era` and `view`.
- Chips read "16-bit · Top-down" in both locales.
- Filtering by `sideview` or by `8bit` keeps exactly the matching projects.
- The new sprite dialog marks the per-kind size.
- `pnpm test` and `tsc` pass.

A runs first. B and C run in parallel after it.
