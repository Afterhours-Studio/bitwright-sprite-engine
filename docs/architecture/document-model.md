# The document model

What a sprite is while it is being made: how it is stored, what the Rust side
exposes, and what the renderer and the MCP server are both coding against.

This is a contract document. Phase 1 tasks 1.1 through 1.7 in
[the plan](../plan/PLAN.md) are written in parallel against the shapes defined
here, so a change to this file is a change to several workers' assumptions and
belongs in review before it is made.

---

## 1. Why indices rather than colours

Every pixel a document stores is a palette index — one byte — not an RGBA value.
The agent, and the user, pick slot 4; what slot 4 currently looks like is a
property of the palette, not of the pixel.

Three things follow from that, and all three are the point:

**Readback becomes cheap and legible.** A 64×64 layer is 4096 bytes, which
renders as 64 lines of 64 characters. An agent can be handed the whole thing,
see exactly what it drew, and correct itself. Hand it an RGBA buffer or a base64
PNG instead and it is drawing blind.

**Recolouring is free and safe.** A palette swap rewrites the palette and not one
pixel of any layer, so a variation cannot drift the value structure of the
original by accident — the thing that makes hand recolours go wrong.

**Palette discipline stops being advice.** A document with sixteen slots cannot
acquire a seventeenth colour by accident, because there is nowhere to put it.
The constraint that pixel artists impose on themselves by willpower is here a
property of the file format.

The cost is one indirection at render time, paid once per composite in a
Uint8ClampedArray walk that is not close to being the slow part of anything.

---

## 2. Storage

One SQLite database under the user's data root, `bitwright.db`. The document is
the database; there is no separate save step and no in-memory copy that can be
lost. Exporting a PNG is a different action entirely, with a folder picker, and
is the only thing in the application that writes an image file.

### Schema

```sql
CREATE TABLE project (
    id           TEXT PRIMARY KEY,          -- uuid v7, so ids sort by creation
    name         TEXT NOT NULL,
    style_id     TEXT REFERENCES style(id), -- the project's default style
    created_at   INTEGER NOT NULL,          -- unix millis
    updated_at   INTEGER NOT NULL
);

CREATE TABLE style (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES project(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    preset       TEXT NOT NULL,             -- 'hd2d' | 'snes' | 'gameboy' | 'custom'
    rules        TEXT NOT NULL,             -- JSON: StyleRules, see §4
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE asset (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    style_id     TEXT REFERENCES style(id),  -- overrides the project default
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,              -- 'character'|'prop'|'tile'|'tileset'|'background'
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    step         TEXT NOT NULL,              -- current workflow step, see §6
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (project_id, name)
);

CREATE TABLE palette (
    asset_id     TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
    slots        TEXT NOT NULL,              -- JSON: PaletteSlot[], index is slot number
    ramps        TEXT NOT NULL               -- JSON: Ramp[], see §4
);

CREATE TABLE layer (
    id           TEXT PRIMARY KEY,
    asset_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    role         TEXT NOT NULL,              -- workflow step that owns it, see §6
    ordinal      INTEGER NOT NULL,           -- composite order, low to high
    visible      INTEGER NOT NULL DEFAULT 1,
    locked       INTEGER NOT NULL DEFAULT 0,
    opacity      REAL NOT NULL DEFAULT 1.0,
    pixels       BLOB NOT NULL,              -- width*height bytes, row major, 0 = transparent
    UNIQUE (asset_id, role)
);

CREATE TABLE reference (
    id           TEXT PRIMARY KEY,
    asset_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    source_png   BLOB NOT NULL,              -- the image as imported, untouched
    conformed    BLOB,                       -- indexed result of conform, may be null
    conform_meta TEXT,                       -- JSON: detected grid, palette, warnings
    created_at   INTEGER NOT NULL
);

CREATE TABLE op (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    layer_role   TEXT,                       -- null for ops that are not layer writes
    kind         TEXT NOT NULL,              -- the tool or command name
    payload      TEXT NOT NULL,              -- JSON: the op's arguments
    inverse      BLOB,                       -- prior bytes of the region it overwrote
    actor        TEXT NOT NULL,              -- 'user' | 'agent:<mcp session id>'
    at           INTEGER NOT NULL
);

CREATE INDEX op_asset_seq ON op (asset_id, seq);
```

### On the op log

Every mutation appends one row, carrying both what it did and the bytes it
overwrote. That single table is undo, redo, replay and provenance at once, and
provenance matters more here than in an ordinary editor: when a sprite is half
drawn by a person and half by an agent, "who put that there" is a question
somebody will ask.

Undo walks backwards applying `inverse`; redo walks forwards applying `payload`.
The log is trimmed per asset at a generous bound rather than kept forever,
because a long agent session is thousands of ops and none of them are large.

### On storing pixels as a BLOB

A layer is one blob, not a row per pixel. Nothing ever queries an individual
pixel through SQL — reads are always whole-layer or whole-region and go through
the raster core, which wants a contiguous buffer anyway.

---

## 3. Rust types

`src-tauri/src/store/` owns persistence; `src-tauri/src/raster/` owns the pixel
work and knows nothing about SQLite.

```rust
pub struct AssetId(pub Uuid);
pub struct LayerRole(pub &'static str);

/// A single layer's pixels. Indices into the asset's palette; 0 is transparent
/// and is not a palette slot, which is why slot numbering in the tool API is
/// 1-based while the palette vector is 0-based.
pub struct IndexedBuffer {
    pub width:  u16,
    pub height: u16,
    pub data:   Vec<u8>,   // width * height, row major
}

pub struct Layer {
    pub id:      Uuid,
    pub role:    LayerRole,
    pub ordinal: i32,
    pub visible: bool,
    pub locked:  bool,
    pub opacity: f32,
    pub buffer:  IndexedBuffer,
}

pub struct Document {
    pub asset:   Asset,
    pub palette: Palette,
    pub layers:  Vec<Layer>,   // sorted by ordinal
}
```

`IndexedBuffer` is the only pixel representation in the Rust half. Compositing
to RGBA happens once, at the edge, when the renderer asks for something to draw.

---

## 4. Palette and style

```rust
pub struct PaletteSlot {
    // 1..=62; 0 is reserved for transparent. The ceiling is 62 because that
    // is how many symbols the grid alphabet has - `A`-`Z`, `a`-`z`, `0`-`9` -
    // and a slot that cannot be named in a readback is a slot an agent cannot
    // see. No pixel art style this application targets wants more.
    pub index: u8,
    pub rgba:  [u8; 4],
    pub name:  Option<String>,
    pub ramp:  Option<String>,   // the ramp this slot belongs to
    pub step:  Option<u8>,       // position within that ramp, 0 = darkest
}

pub struct Ramp {
    pub name:     String,        // "skin", "cloth-red", "metal-gold"
    pub material: Material,
    pub slots:    Vec<u8>,       // slot indices, darkest first
}
```

A ramp is the unit the shading tools work in. When the agent says *this region
takes core shadow*, the engine looks up which ramp the region's base slot
belongs to and steps down it. That is the mechanism behind the rule that the
engine chooses colours and the agent chooses places — the agent never names a
hex value, and so can never invent a muddy one.

`StyleRules`, stored as JSON on `style.rules`, is what the gates are checked
against:

```jsonc
{
  "maxSlots": 24,                  // hard ceiling on palette size
  "rampSteps": { "min": 3, "max": 5 },

  // Per ramp step, in HSL degrees, positive rotating toward blue/violet.
  // Darker steps rotate cool and gain a little chroma before losing it at
  // the deepest step; lighter steps rotate warm and lose chroma.
  "hueShift": {
    "darkerHueDeg":      [12, 20],
    "darkerChromaFactor": [0.85, 1.12],
    "darkerDeltaL":      [-0.13, -0.08],   // OKLCH
    "lighterHueDeg":     [-20, -12],
    "lighterChromaFactor": [0.70, 0.85],
    "lighterDeltaL":     [0.09, 0.15]
  },

  // Skin, and anything translucent, rotates toward red/magenta in shadow
  // rather than toward blue. Subsurface scattering; the one exception.
  "warmShadowMaterials": ["skin"],

  "valueFloor":   [0.10, 0.16],   // darkest slot, OKLCH L
  "valueCeiling": [0.88, 0.94],   // lightest slot, excepting a 1px specular
  "minEdgeDeltaL": 0.07,          // two touching slots that must read apart

  "outline": "selective",         // 'none' | 'selective' | 'full'
  "outlineCoverage": [0.60, 0.75],
  "lightDirection": "upper-left",
  "rimCoverage": [0.15, 0.25],    // fraction of perimeter
  "noiseBudget": 0.02,            // max fraction of isolated single pixels
  "canvas": { "width": 48, "height": 64 }
}
```

The numeric bounds in the `hd2d` preset come from
[the HD-2D style guide](../pixel-art/hd2d-style-guide.md), which is the research
those numbers are drawn from rather than a second opinion about them.

---

## 5. Colour space

Palette slots are stored as sRGB bytes because that is what a PNG holds and what
a user types. Every judgement about colour — nearest slot, ramp ordering, hue
shift validation, the perceptual distance the gates use — is made in Oklab.

This is the same choice
[ADR-0005](decisions/0005-oklch-color-tokens.md) made for the interface tokens,
for the same reason: distances in sRGB do not correspond to distances the eye
agrees with, and a palette reduction that believes they do produces exactly the
"close to right rather than right" failure the old conform step was written to
undo.

---

## 6. Steps and layers

An asset's `step` column names where it is in the workflow. Each step owns
exactly one layer role, which is why `layer` has a `UNIQUE (asset_id, role)`
constraint: a step's output is a single addressable thing that can be inspected,
regenerated or thrown away without disturbing the steps around it.

| Step         | Layer role     | Ordinal | Holds                                       |
| ------------ | -------------- | ------- | ------------------------------------------- |
| `reference`  | —              | —       | nothing; writes to the `reference` table    |
| `palette`    | —              | —       | nothing; writes to the `palette` table      |
| `silhouette` | `silhouette`   | 10      | the filled mask, one slot                   |
| `flats`      | `flats`        | 20      | each material's base slot, unshaded         |
| `shadow`     | `shadow-core`  | 30      | the first shadow band                       |
|              | `shadow-deep`  | 31      | occlusion and the darkest band              |
| `light`      | `light`        | 40      | lit planes                                  |
| `outline`    | `outline`      | 50      | outline pixels                              |
| `detail`     | `detail`       | 60      | interior features, folds, face              |
| `accent`     | `rim`          | 70      | the backlight edge                          |
|              | `accent`       | 71      | speculars and the highest-contrast marks    |
| `cleanup`    | —              | —       | nothing; anti-aliases and despeckles in place |
| `variation`  | —              | —       | nothing; forks the asset with a new palette |

Compositing is ordinal order, low first, each layer's non-zero indices painting
over what is beneath. Opacity below 1.0 is resolved at composite time in Oklab
and is a preview affordance — an exported sprite has no partial alpha except
where the silhouette says so.

The step order is not arbitrary. It is
[the style guide's §9](../pixel-art/hd2d-style-guide.md), and each position in
it is there for a reason worth restating, because the obvious orders are wrong:

**Silhouette before anything**, because shape is what the viewer resolves first
and what is hardest to change once anything is painted into it.

**Flats before shading**, because the material map decides the colour-area
proportions, and revising it after shading means redoing every shaded pixel.
This is why flats are a layer of their own rather than more silhouette: the
silhouette is one opaque slot answering "what shape", the flats answer "made of
what", and the two get revised for different reasons.

**Shadow before light.** The shadow shape *is* the description of the form.
Placing light first tempts the artist, and the agent, into shading inward from
the edge, which is pillow shading — the failure the gates spend the most effort
detecting.

**Outline after the fills it borders exist.** An outline's colour is derived
from the fill beside it, so outlining early means guessing, and the guess is
always flat black. This is the one place the ordering here is likely to surprise
someone: the outline goes on late, not first.

**Detail late**, because detail added before the form is resolved is detail its
author then protects instead of fixing the form underneath it.

**Rim and accents last**, because they are the highest-contrast pixels on the
sprite and placing them last is the only way to place them where they earn it —
and to count them against a budget.

**Cleanup last of all**, because anti-aliasing is a polish pass over finished
edges, and doing it before the edges are finished means doing it twice.

---

## 7. Tauri commands

The renderer's whole view of the document goes through these. Names are
`document_*` for reads and writes on the open document, `project_*` for the
tree. All are async and return `Result<T, AppError>` with the stable error codes
the existing `EngineError` already uses.

```
project_list()                              -> Project[]
project_create(name, preset)                -> Project
project_rename(id, name)                    -> Project
project_delete(id)                          -> ()

asset_list(project_id)                      -> Asset[]
asset_create(project_id, name, kind, w, h)  -> Asset
asset_rename(id, name)                      -> Asset
asset_delete(id)                            -> ()
asset_open(id)                              -> Document

document_composite(asset_id)                -> RgbaImage      // for the canvas
document_read_layer(asset_id, role)         -> IndexedBuffer
document_write_ops(asset_id, ops)           -> OpResult       // the single write path
document_undo(asset_id)                     -> OpResult
document_redo(asset_id)                     -> OpResult

palette_read(asset_id)                      -> Palette
palette_write(asset_id, palette)            -> Palette

step_state(asset_id)                        -> StepState
step_check(asset_id)                        -> GateReport
step_advance(asset_id)                      -> StepState
```

`document_write_ops` taking a batch rather than a single op is deliberate: a
user's brush stroke and an agent's `draw_run` are the same thing arriving at
different granularities, and both want to land as one undo entry.

### The op payload

An op is a tagged union, serialised with an explicit `kind` discriminant rather
than inferred from which fields are present. A log that has to be replayed years
later should not depend on a reader guessing what it is looking at.

```rust
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Op {
    PasteGrid  { layer: LayerRole, x: u16, y: u16, rows: Vec<String>, mode: PasteMode },
    DrawRuns   { layer: LayerRole, runs: Vec<Run> },        // Run { y, x0, x1, slot }
    SetPixels  { layer: LayerRole, pixels: Vec<PixelSet> }, // PixelSet { x, y, slot }
    DrawShape  { layer: LayerRole, shape: Shape, from: Point, to: Point,
                 slot: u8, fill: bool, pixel_perfect: bool },
    FillRegion { layer: LayerRole, x: u16, y: u16, slot: u8, contiguous: bool },
    Mirror     { layer: LayerRole, axis: Axis, about: Option<u16> },
    Translate  { layer: LayerRole, dx: i32, dy: i32 },
    Clear      { layer: LayerRole },
    Shade      { target: LayerRole, from: LayerRole, region: Option<Rect>,
                 kind: ShadeKind, direction: Direction, depth: u8 },
    Outline    { from: LayerRole, mode: OutlineMode, darken: u8 },
    Antialias  { layer: LayerRole, strength: u8 },
}
```

Every variant names the layer it writes, which is what lets `document://changed`
report the affected roles without re-reading anything.

### The undo cursor

Undo does not delete op rows. It moves a cursor, stored per asset, and redo
moves it back; a new write truncates everything after the cursor and then
appends. Deleting on undo would make redo impossible, and an op log that loses
history on undo is not a log.

The cursor lives in its own table with the schema version that introduced it, so
it is migrated rather than inferred. Inferring it from the last op would be
wrong the moment an asset is opened after being undone and closed.

## 8. Events

The renderer does not poll. Rust emits, the renderer listens.

| Event                 | Payload                                | When                                    |
| --------------------- | -------------------------------------- | --------------------------------------- |
| `document://changed`  | `{ assetId, roles[], seq }`            | after any write, from either actor      |
| `document://palette`  | `{ assetId }`                          | palette edited                          |
| `document://step`     | `{ assetId, step, gate }`              | step advanced or gate re-evaluated      |
| `agent://activity`    | `{ sessionId, tool, assetId }`         | an MCP tool call started                |
| `agent://session`     | `{ sessionId, state }`                 | MCP client connected or disconnected    |

`document://changed` names the layer roles that moved rather than carrying
pixels, so the renderer re-composites only what changed and a fast agent cannot
flood the IPC channel with buffers. Emission is coalesced on a frame boundary
for exactly that reason.

The MCP server writes through the same `document_write_ops` path the renderer
uses. There is no second write path, which is what makes an agent's edit and a
user's edit indistinguishable to undo — and lets the two of them work on the
same sprite at the same time without either one's history being a lie.
