# The MCP tool catalogue

Every tool the Bitwright MCP server exposes, what it takes, what it returns, and
how it fails.

This is a contract document. Phase 2 tasks 2.1 through 2.6 in
[the plan](../plan/PLAN.md) are built in parallel against it, and it is the
specification an agent is really programming against, so it is written to be
read by whoever is implementing a tool and by whoever is debugging why an agent
used it wrong.

It assumes [the document model](document-model.md).

---

## Status

Phase 2 through Phase 4 are built. Every tool in the catalogue answers for
real; nothing here is a placeholder.

| Section               | Tools                                                                                                      | Available now | Delivered by |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- | ------------ |
| 3. The guide          | `read_guide`                                                                                               | yes           | Phase 1      |
| 4. Orientation        | `list_projects`, `create_project`, `list_assets`, `create_asset`, `open_asset`, `get_style_rules`          | yes           | Phase 2      |
| 5. Reading the canvas | `read_canvas`, `read_region`, `describe_palette`, `diff_layers`, `read_reference`                          | yes           | Phase 2/3    |
| 6. Writing            | `paste_grid`, `draw_runs`, `set_pixels`, `draw_shape`, `fill_region`, `mirror`, `translate`, `clear_layer` | yes           | Phase 2      |
| 7. The shading tools  | `shade`, `outline`, `antialias`                                                                            | yes           | Phase 2      |
| 8. Palette            | `set_palette`, `create_variation`, `extract_palette`                                                       | yes           | Phase 2/3    |
| 9. The workflow       | `get_step`, `check_step`, `advance_step`, `revisit_step`                                                   | yes           | Phase 2      |
| 10. Tilemaps          | `create_tilemap`, `read_tilemap`, `place_tiles`, `tilemap_layers`                                          | yes           | Phase 3      |
| 11. Export            | `export_png`, `export_sheet`                                                                               | yes           | Phase 4      |
| 12. History           | `undo`, `redo`, `read_history`                                                                             | yes           | Phase 2      |

There is no skills installer: the drawing manual is served by the server itself,
through `read_guide` and the `bitwright://guide/*` resources, so every client
connected over MCP has it.

---

## 1. The shape of the API, and why

An agent drawing a sprite is not an agent calling `set_pixel` four thousand
times. It is also not an agent handed a single `draw_sprite(description)` that
does the work for it. The catalogue sits deliberately between those, on three
rules.

**Read is whole and cheap.** A 64×64 layer comes back as sixty-four lines of
sixty-four characters with rulers down the side. That is about 1.3k tokens, and
an agent that can see what it drew is the entire difference between this working
and not working. Nothing in the API makes an agent guess at the current state.

**Write meets the agent where it is.** Pasting a whole grid, sending run-length
rows, and setting three individual pixels are all first-class. An agent laying
down a silhouette should paste a grid; an agent fixing a stray pixel should send
one pixel. Forcing either to impersonate the other wastes tokens and invites
mistakes.

**Colour is the engine's decision, placement is the agent's.** No tool accepts a
hex value for shading. The agent says _this region takes core shadow with light
from the upper left_; the engine resolves which ramp step that is. This is the
single largest lever on output quality, because choosing hex values by hand is
where model-drawn pixel art turns muddy.

---

## 2. Conventions

**Slots, not colours.** Pixel values are palette slot numbers. Slot `0` is
transparent and is not a palette entry. Tools take and return slot numbers
everywhere except `set_palette`.

**Characters in grids.** A grid is rendered with `.` for slot 0, then `A`–`Z`
for slots 1–26, then `a`–`z` for slots 27–52, then `0`–`9` for 53–62. A document
may not exceed 62 slots, which no pixel art style wants to anyway.

**Coordinates.** `x` runs left to right from 0, `y` runs top to bottom from 0.
Every rectangle argument is `x, y, w, h` and every span is inclusive of both
ends.

**Layers by role, never by id.** Tools address `"silhouette"`, `"outline"`,
`"shadow-core"` and so on. An agent never sees a layer id.

**Every write returns a diff summary**, not the new canvas: `{ changed: <n>,
bounds: {x,y,w,h}, seq }`. The agent re-reads when it wants to see, and the
count alone catches the common failure of a write that silently did nothing.

**Errors are structured.** `{ code, message, hint }` with a stable code. The
hint is written for a model: it says what to do instead, not merely what went
wrong.

| Code                     | Means                                          |
| ------------------------ | ---------------------------------------------- |
| `asset.not_found`        | no such asset id                               |
| `asset.not_open`         | the tool needs an open asset and none is open  |
| `layer.unknown_role`     | role is not one of the workflow roles          |
| `layer.locked`           | the layer is locked in the interface           |
| `step.wrong`             | this layer does not belong to the current step |
| `step.gate_failed`       | `advance_step` refused; the report says why    |
| `slot.out_of_range`      | slot number is not in the palette              |
| `bounds.outside`         | coordinates fall outside the canvas            |
| `grid.size_mismatch`     | pasted grid is not the size the target expects |
| `grid.bad_character`     | a character in the grid maps to no slot        |
| `palette.rule_violation` | the write breaks the style's palette rules     |

---

## 3. The guide

### `read_guide`

`{ topic?: string }` — `topic` is one of `overview` (the default), `workflow`,
`palette`, `recipes` or `troubleshooting`. Returns `{ topic, title, text,
topics }`: the requested document's text, and the full topic list so an agent
that wants another one does not have to guess the name.

This is the operating manual — how to draw a sprite here, step by step, with
the palette rules, recipes and fixes for failed gates — served by the server
itself rather than baked into a system prompt that drifts from the tools. An
agent reads `overview` before its first drawing call, then the topic a step or
a failed gate names. The same text is also published as `bitwright://guide/*`
resources, for a client that prefers resources to a tool call; `read_guide`
is the one door every client can use, which is why it is first in the
catalogue.

An unknown topic returns `args.invalid` with a hint naming the real ones.

---

## 4. Orientation

### `list_projects`

No arguments. Returns each project's `id`, `name`, `style`, and asset count.

### `create_project`

`{ name: string, preset?: "hd2d" | "snes" | "gameboy" | "custom" }`
Defaults to `hd2d`. Returns the project.

### `list_assets`

`{ projectId: string }` — id, name, kind, size, current step, gate status.

### `create_asset`

```jsonc
{
  "projectId": "…",
  "name": "sofia-idle-south",
  "kind": "character", // character | prop | tile | tileset | background
  "width": 64, // optional; defaults come from the style preset
  "height": 64,
}
```

Creates the asset with its layers empty and its step at `reference`. Returns the
asset and the style rules in force, so the agent learns the palette ceiling, the
light direction and the ramp bounds without a second call.

### `open_asset`

`{ assetId: string }` — makes it the session's current asset and brings it up in
the application window, so the person watching sees what the agent is about to
work on. Returns the full asset state: step, gate report, palette, and a
one-line summary of which layers have content.

### `get_style_rules`

`{ assetId?: string }` — the rules the gates will be checked against. An agent
that reads this before drawing does not have to discover the constraints by
failing them.

---

## 5. Reading the canvas

### `read_canvas`

```jsonc
{
  "assetId": "…",
  "layer": "silhouette", // omit for the flattened composite
  "region": { "x": 0, "y": 0, "w": 64, "h": 64 }, // optional
  "rulers": true, // default true
}
```

Returns the grid as text, with the legend:

```
legend: A=1 skin.base  B=2 skin.shadow  C=3 cloth.base  .=transparent

        0    5    10   15   20   25   30
   28 | ..........AAAAAAAA..............
   29 | ........AABBBBBBBBAA............
   30 | ......AABBBCCCCCCBBBBAA.........
```

Rulers are on by default because a model counting unaided to column 37 on row 41
will miss, and a single wrong column ruins a shading pass.

For a `background` asset, `read_canvas` returns the tilemap — a grid of tile
ids, not pixels. A 20×12 tilemap is 240 characters where its pixels would be
57,600. Reading an individual tile is `read_canvas` with `layer: "tile:<id>"`.

### `read_region`

`{ assetId, layer?, x, y, w, h }` — the same thing scoped, for canvases large
enough that the whole grid is not worth carrying. Identical output format.

### `describe_palette`

`{ assetId }` — every slot with its hex, name, ramp and position in that ramp,
and every ramp with its material and its steps darkest-first. This is how an
agent learns that slot 7 is `cloth-red` step 2 of 4 and therefore what stepping
down from it means.

### `read_reference`

`{ assetId?, referenceId?, rulers? }` — a stored reference image indexed to
the asset's own palette and rendered as the same kind of grid and legend
`read_canvas` gives, plus what conforming it detected. `referenceId` defaults
to the most recently imported reference; `rulers` defaults `true`. Returns
`{ referenceId, name, width, height, text, detected, warnings }`, where
`detected` and `warnings` are whatever `conform_meta` recorded (`null` and
`[]` for a reference that predates conforming). If the asset has no palette
yet, `text` is prefixed with a line pointing at `extract_palette` and
`set_palette`, since every pixel would otherwise read as empty. Import
happens elsewhere, in the window's reference panel; this tool only reads what
the store already has. Fails `reference.none` when the asset has no reference
image at all, and `reference.not_found` for a `referenceId` the asset does
not have.

### `diff_layers`

`{ assetId, a: "silhouette", b: "outline" }` — where two layers disagree, as a
grid of `=` and `X`. The cheap way to answer "did my outline stay inside the
silhouette" without reading both and comparing by eye.

---

## 6. Writing

Every write takes `assetId` and `layer`, and every write refuses a layer that
does not belong to the current step unless `force: true` is passed — revisiting
an earlier step is legitimate, and doing it by accident is not.

### `paste_grid`

```jsonc
{
  "assetId": "…",
  "layer": "silhouette",
  "x": 0,
  "y": 0,
  "rows": ["..........AAAAAAAA..............", "........AAAAAAAAAAAA............"],
  "mode": "replace", // replace | over   (over keeps existing non-zero)
}
```

All rows must be the same length. The natural tool for a silhouette or a whole
tile.

### `draw_runs`

```jsonc
{
  "assetId": "…",
  "layer": "shadow-core",
  "runs": [
    { "y": 28, "x0": 10, "x1": 17, "slot": 2 },
    { "y": 29, "x0": 8, "x1": 19, "slot": 2 },
  ],
}
```

Run-length rows. The most economical way to fill a shape an agent is describing
scanline by scanline, and the form most robust against miscounting, because each
run states its own endpoints rather than relying on position in a string.

### `set_pixels`

`{ assetId, layer, pixels: [{ x, y, slot }] }` — for corrections. Capped at 512
pixels per call; past that, the agent wanted `paste_grid` or `draw_runs`.

### `draw_shape`

```jsonc
{
  "assetId": "…",
  "layer": "detail",
  "shape": "line", // line | rect | ellipse | curve
  "from": { "x": 12, "y": 20 },
  "to": { "x": 30, "y": 34 },
  "slot": 5,
  "fill": false,
  "pixelPerfect": true, // drop redundant corner pixels on diagonals
}
```

`pixelPerfect` defaults true, because the doubled corner pixel on a diagonal is
the most recognisable tell of machine-drawn pixel art.

### `fill_region`

`{ assetId, layer, x, y, slot, contiguous: true }` — flood fill from a seed,
four-connected, over whichever slot is at the seed.

### `mirror`

`{ assetId, layer, axis: "x" | "y", about?: number }` — mirrors the layer, or
its left half onto its right, about the given column. Symmetry is how a
front-facing character gets drawn once and finished twice, and doing it by hand
is where drift enters.

### `translate`

`{ assetId, layer, dx, dy }` — shifts a layer's content. Pixels pushed off the
canvas are lost and the response says how many.

### `clear_layer`

`{ assetId, layer }` — empties it. One op, so one undo.

---

## 7. The shading tools

These are the ones where the engine decides the colour.

### `shade`

```jsonc
{
  "assetId": "…",
  "target": "shadow-core", // shadow-core | shadow-deep | light | rim
  // the target layer IS the band; there is no
  // second argument that can contradict it
  "from": "flats", // the layer whose material slots are being shaded
  "region": { "x": 0, "y": 0, "w": 64, "h": 64 }, // optional, defaults to all
  "direction": "upper-left", // omitted: taken from the style rules
  "depth": 1, // how many ramp steps to move; default 1
}
```

For every pixel in the region, the engine finds which ramp the source pixel's
slot belongs to and steps along it — down for shadow, up for light — writing the
result to the target layer. Surfaces facing away from the light take shadow;
surfaces facing it take light; `rim` writes only to the edge pixels on the side
away from the key light, which is the signature HD-2D move.

The agent never names a colour. If a source slot belongs to no ramp, those
pixels are skipped and the count is reported, which is usually how an agent
finds out it has been painting with an unramped slot.

### `outline`

```jsonc
{
  "assetId": "…",
  "from": "flats", // outline colour is derived from the fill it borders
  "mode": "selective", // none | selective | full; default from the style
  "darken": 2, // ramp steps below the adjacent fill
}
```

Writes the `outline` layer. `selective` — what HD-2D actually does — omits the
outline on edges the key light strikes, so the sprite reads as lit rather than
as a sticker. The outline colour is derived per pixel from the fill it borders,
never a flat black, which is the other most recognisable tell of amateur pixel
art.

### `antialias`

`{ assetId, layer, strength: 1 }` — places intermediate ramp steps on
stair-stepped interior edges. It refuses to touch the outer silhouette boundary,
because a sprite that will sit on backgrounds of unknown colour must have a hard
outer edge, and anti-aliasing it produces the halo that the old conform pipeline
existed to remove.

---

## 8. Palette

### `set_palette`

```jsonc
{
  "assetId": "…",
  "ramps": [
    { "name": "skin", "material": "skin", "slots": ["#5C3B2E", "#8A5B41", "#C08A63", "#E8BC94"] },
    {
      "name": "cloth-red",
      "material": "cloth",
      "slots": ["#5A1720", "#8E2430", "#C33A42", "#E2645F"],
    },
  ],
}
```

The only tool that accepts hex values, and it is checked against the style
rules: slot ceiling, ramp length, and the hue-shift bounds — shadows must move
cool and lose chroma, lights must move warm. A flat ramp that only changes
lightness is rejected with `palette.rule_violation` and a hint naming the ramp,
because that is the mistake, and it is the one that makes a sprite look plastic.

### `extract_palette`

`{ assetId?, referenceId?, maxSlots? }` — turns a reference's colours into
ramps, in exactly the shape `set_palette` takes. Colour comes from
`conform_meta.palette` when the reference has one, else from the distinct
opaque pixels of its decoded PNG, most-used first; `maxSlots` (default 32, 1
to 62) caps how many are kept. The kept colours are grouped by Oklab hue into
30-degree buckets — a near-neutral colour is named `neutral` instead of a hue
bucket — any bucket left holding a single colour is folded into whichever
remaining bucket sits nearest it in hue, and each ramp is sorted darkest slot
first. Every ramp comes back tagged `material: "custom"`, since the grouping
is by hue alone and knows nothing of the style's materials; `set_palette`
still checks the result against the style when it is applied. Returns
`{ referenceId, ramps }`. It applies nothing by itself: hand the ramps
straight to `set_palette` — tags edited or not — to make them the asset's
palette. Fails the same way `read_reference` does when there is no reference
to read, plus `reference.invalid` when `conform_meta.palette` holds something
that is not a `#RRGGBB` string.

### `create_variation`

`{ assetId, name, remap: [{ ramp: "cloth-red", to: ["#1B2A5A", …] }] }` — forks
the asset with a new palette and identical layers. The value structure is
preserved by construction, since not one pixel moves.

---

## 9. The workflow

### `get_step`

`{ assetId }` — the current step, what it expects, and the gate report as it
stands.

### `check_step`

`{ assetId }` — evaluates the gate now, without advancing. Returns:

```jsonc
{
  "step": "silhouette",
  "pass": false,
  "checks": [
    {
      "name": "single-region",
      "pass": false,
      "detail": "3 disconnected regions; largest is 812px, others 4px and 2px",
      "hint": "Remove the stray pixels at (51,12) and (9,44), or connect them.",
    },
    { "name": "reads-at-1x", "pass": true },
  ],
}
```

Every check is computed from the pixel buffer. A gate is never something the
agent asserts; it is something the engine measures. The `hint` is written to be
actionable by a model, naming coordinates wherever it can.

### `advance_step`

`{ assetId, force?: false }` — moves to the next step if the gate passes,
otherwise fails with `step.gate_failed` and the same report. `force` is
available and is recorded in the op log as a forced advance, because a person
overriding a gate is legitimate and an agent doing it silently is not.

### `revisit_step`

`{ assetId, step }` — moves back. Nothing is erased; earlier layers are still
there, which is the whole reason the steps are separate layers.

---

## 10. Tilemaps

Backgrounds built from tile assets placed on a grid, rather than drawn pixel
by pixel. A `background` asset holds at most one tilemap; the tiles it places
are ordinary `tile` assets, drawn beforehand with the normal tools. Every tool
but `create_tilemap` fails `tilemap.none` on a background that has no
tilemap yet.

### `create_tilemap`

```jsonc
{
  "assetId": "…", // optional; defaults to the session's open asset
  "tileWidth": 16,
  "tileHeight": 16,
  "columns": 20,
  "rows": 12,
}
```

Starts a tilemap on a background asset: a grid of tile-sized cells and one
layer, named `ground`. Returns the tilemap summary — `tileWidth`,
`tileHeight`, `columns`, `rows`, and `layers` (each with `name`, `parallax`,
`visible`, `placed`). Fails `tilemap.exists` when the asset already has one —
call `place_tiles` or `tilemap_layers` to edit it, or `read_tilemap` to see
it — `tilemap.invalid_size` when a dimension is out of range, and
`tilemap.not_background` when the asset is not a `background`.

### `read_tilemap`

`{ assetId?, layer? }` — a tilemap as a text grid: `.` for an empty cell, then
`a`–`z`, `A`–`Z`, `0`–`9` for each distinct tile in the order it first
appears, one character per cell. A legend line names each symbol
(`a = grass (<tile asset id>)`), followed by every layer in turn — or just
`layer`, when given — each headed `layer <name> (parallax <p>, visible|hidden):`
and then its grid. Returns the tilemap summary plus `text`. Fails
`tilemap.layer_not_found` for an unknown layer name, and
`tilemap.too_many_tiles` when more distinct tiles are placed than the
62-character set can label — call again scoped to a single layer.

### `place_tiles`

```jsonc
{
  "assetId": "…",
  "layer": "ground",
  "placements": [
    { "x": 0, "y": 0, "tile": "…" }, // a tile asset's id
    { "x": 2, "y": 1, "tile": null }, // null clears the cell
  ],
}
```

Places or clears tiles on one layer of a tilemap, and refreshes the open
window. Returns `{ changed: <n>, ...tilemap summary }`. Nothing is written
when a placement is refused: fails `tilemap.out_of_bounds` for a cell outside
the grid, `tilemap.tile_invalid` when `tile` is not a `tile` asset in the same
project or is not sized to the map's tile size, and `tilemap.layer_not_found`
for an unknown layer.

### `tilemap_layers`

`{ assetId?, add?: { name, parallax }, remove?: name, set?: { name, parallax?, visible? } }`
— exactly one of `add`, `remove`, or `set` per call; passing zero or more than
one fails `args.invalid`. Layers are drawn back to front; `parallax` scales
how fast a layer scrolls relative to the camera. Returns the tilemap summary.
Fails `tilemap.layer_exists` adding a name already in use, `tilemap.layer_not_found`
removing or setting one that is not there, `tilemap.last_layer` removing a
tilemap's only remaining layer, `tilemap.invalid_layer` for a parallax outside
0 to 4 or a name that is empty or over 40 characters, and
`tilemap.invalid_size` adding a ninth layer.

---

## 11. Export

Writes a PNG to disk: a background asset's tilemap render, or any other
kind's layer composite. An agent cannot choose where the file lands — every
export goes to
`<data root>/exports/<safe project name>-<last 8 hex characters of the project id>/`,
a folder named for the asset's project and made safe from its own name the
same way a file name is (see [the contract](tilemap-and-export.md#export)),
so a hostile project or asset name can only ever produce an ugly folder,
never escape the exports root. That is the one restriction Export tools
carry that the person's own "Save As" does not: the interface lets a person
point anywhere on disk, because a person already had that access; the tool
surface never grants an agent more.

### `export_png`

```jsonc
{
  "assetId": "…", // optional; defaults to the session's open asset
  "scale": 1, // 1..=16, nearest-neighbour upscale; defaults to 1
  "name": "{asset}@{scale}x", // optional; a file name pattern
  "overwrite": false, // optional; defaults to false
}
```

`name` substitutes `{project}`, `{asset}`, `{kind}` and `{scale}`, then the
result is made a safe file name the same way the folder is. Returns
`{ path, width, height }` — where the file landed and its pixel size. Fails
`export.invalid_scale` for a scale outside `1..=16`, and also for a scale
that would scale the asset past 8192px on either side; `export.invalid_pattern`
when the pattern is empty or empty after substitution, `export.exists` when
the file is already there and `overwrite` is false, `export.write_failed` for
any other write failure, and `export.no_directory` when the exports folder
cannot be created.

### `export_sheet`

```jsonc
{
  "assetIds": ["…", "…"], // all the same size, all one project
  "columns": 2, // optional; defaults to one row
  "scale": 1, // optional; defaults to 1
  "name": "sheet", // a file name pattern; {asset} and {kind} become "sheet"
  "overwrite": false, // optional; defaults to false
}
```

Lays the assets left to right, wrapped after `columns`, into one sheet, then
writes it the same way `export_png` does. Returns `{ path, width, height }`.
Fails `export.empty` with no assets, `export.mixed_sizes` when they are not
all the same size, `export.mixed_projects` when they do not all belong to one
project, and the same `export.invalid_scale` — for a scale outside `1..=16`,
or one that would scale the sheet past 8192px on either side —
`export.invalid_pattern`, `export.exists`, `export.write_failed` and
`export.no_directory` as `export_png`.

Both fail the store's own reason code, `document.not_found`, when an asset id
is a well-formed uuid that does not resolve to an asset, and `asset.not_found`
when it is not a uuid at all — malformed input is caught before the store is
ever asked. `export_png` also fails `asset.not_open` when `assetId` is
omitted with no session asset open, since only it has a session to fall back
on.

---

## 12. History

### `undo` / `redo`

`{ assetId, count?: 1 }` — walks the op log. An agent's undo and a person's undo
are the same operation on the same log, because MCP writes go through the same
path the interface does.

### `read_history`

`{ assetId, limit?: 50 }` — recent ops with actor and timestamp. How an agent
resuming a session finds out what it, or the person, last did.

---

## 13. Transports, sessions and trust

Two transports, chosen in Settings.

**HTTP Local** is the primary. The server binds loopback only, exactly as the
Python sidecar already does, and requires the same style of bearer token, shown
in Settings for the user to paste into their client's configuration. A request
carrying an `Origin` header is refused outright, which is what stops a web page
in the user's browser from reaching a server bound to their own machine.

**Stdio** runs the same binary as `bitwright --mcp-stdio`, for headless and
scripted use. It has no window to update and no token, because its trust
boundary is the process that spawned it.

A session is identified in the op log as `agent:<session id>`, so a sprite drawn
by two agents and a person records which of them drew what.

**What the server will not do.** It does not read or write files outside the
project's export directory, it does not execute anything, and it does not reach
the network. Its entire surface is the document. That is not a limitation to be
relaxed later; it is the reason it is safe to point an autonomous agent at it
and walk away.
