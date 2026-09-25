# Animation frames (1.2)

An animation is a sequence of sprites. Each frame is an ordinary asset — its
own layers, its own workflow step, its own op log and undo — and the
animation is the ordered list of those assets with a duration each. This is
the same move the tilemap made: a background is a grid of tile assets, an
animation is a row of frame assets. Nothing in the layer, op or gate model
changes, so every drawing tool, every MCP tool and every gate works on a
frame exactly as it works on a sprite today.

This file is the contract every Phase 5 task builds from.

## Model

- Every asset is an animation of one frame until a second frame is added.
- The **root** is the frame at position 0. The animation is named, listed and
  opened by its root; the home screen shows roots only, with a frame count.
- Frames share a palette. A palette write to any frame is written to every
  frame of its animation in the same transaction, each recorded in that
  frame's own op log under the same actor, so undo on one frame undoes that
  frame's copy only. (Undoing a palette change therefore means undoing it on
  each frame, or writing the palette again — documented, not hidden.)
- Frame assets are named `<root name> #<position + 1>` (position 0 keeps the
  root's own name). Renaming the root renames the others; renaming a
  non-root frame is refused with `animation.frame_name`.
- Frames have the root's size, kind, project and style.
- Playback is `forward | reverse | pingpong`, stored on the animation.
- A frame's duration is 10..=10000 ms, default 125 (8 FPS).

### Schema — migration 5

```sql
CREATE TABLE frame (
    asset_id    TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
    root_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    UNIQUE (root_id, position)
);
CREATE TABLE animation (
    root_id     TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
    playback    TEXT NOT NULL DEFAULT 'forward'
);
```

Rows exist only once an asset has a second frame (then the root has a row at
position 0 too, and an `animation` row). An asset with no `frame` row is a
one-frame animation with duration 125 and playback forward. Removing frames
back down to one deletes the rows again.

## Store (Rust, `store/animation.rs`, methods on `Store`)

```rust
pub struct Frame { pub asset_id: AssetId, pub position: u32, pub duration_ms: u32, pub name: String, pub step: String, pub updated_at: i64 }
pub struct Animation { pub root_id: AssetId, pub playback: String, pub frames: Vec<Frame> }   // serde camelCase

fn animation_read(&self, any_frame: AssetId) -> Result<Animation>;
fn frame_add(&mut self, after: AssetId, copy: bool) -> Result<Animation>;          // inserts after `after`; copy: its layers, palette and step (not its references); blank: empty layers, same palette, step = the earlier of the source's step and "silhouette"
fn frame_add_as(&mut self, after: AssetId, copy: bool, actor: &str) -> Result<Animation>;
fn frame_delete(&mut self, frame: AssetId) -> Result<Animation>;                   // refuses the last frame (animation.last_frame); deleting the root promotes position 1
fn frame_move(&mut self, frame: AssetId, to: u32) -> Result<Animation>;             // to clamped to the frame count - 1
fn frame_set_duration(&mut self, frame: AssetId, ms: u32) -> Result<Animation>;    // animation.invalid_duration outside 10..=10000
fn animation_set_duration(&mut self, any_frame: AssetId, ms: u32) -> Result<Animation>; // every frame (the FPS control)
fn animation_set_playback(&mut self, any_frame: AssetId, mode: &str) -> Result<Animation>; // animation.invalid_playback
```

`Asset` gains `root_id: Option<AssetId>` (the root of the animation it is a
non-root frame of, else null) and `frames: u32` (for a root or a lone
asset: its frame count, ≥ 1; for a non-root frame: 0), filled by every query
that returns assets. `asset_delete` on a root deletes every frame asset of
the animation; on a non-root frame it behaves as `frame_delete`.
`asset_rename` follows the naming rule above. `palette_write(_as)` follows
the sharing rule. Error codes: `animation.last_frame`,
`animation.invalid_duration`, `animation.invalid_playback`,
`animation.frame_name`, `animation.mixed` (reserved for cross-animation moves).

## Tauri commands (`commands/animation.rs`)

| command                  | args                        | returns                          |
| ------------------------ | --------------------------- | -------------------------------- |
| `animation_read`         | `{ assetId }`               | `Animation`                      |
| `frame_add`              | `{ assetId, copy }`         | `Animation`                      |
| `frame_delete`           | `{ assetId }`               | `Animation`                      |
| `frame_move`             | `{ assetId, to }`           | `Animation`                      |
| `frame_set_duration`     | `{ assetId, ms }`           | `Animation`                      |
| `animation_set_duration` | `{ assetId, ms }`           | `Animation`                      |
| `animation_set_playback` | `{ assetId, mode }`         | `Animation`                      |
| `export_gif`             | `{ assetId, scale, path? }` | `ExportResult` (as `export_png`) |

Every command that changes an animation emits `document://animation` with
`{ rootId, animation }` — as does the MCP host when an agent changes one — so
a timeline stays live while an agent adds frames.

## MCP tools (`mcp/tools/animation.rs`)

- `read_animation { assetId? }` → the `Animation`.
- `add_frame { assetId?, copy?: true }` → `{ animation, frame }` — the new
  frame's asset id; the session's open asset becomes the new frame, because
  the next thing an agent does after adding a frame is draw on it.
- `delete_frame { assetId }`, `move_frame { assetId, to }`,
  `set_frame_duration { assetId, ms }`, `set_animation_duration { assetId?, ms }`,
  `set_playback { assetId?, mode }` → the `Animation`.
- `export_gif { assetId?, scale?, name?, overwrite? }` → `{ path, width, height, frames }`,
  written to the exports folder like `export_png`, looping forever, honouring
  playback (pingpong writes `0..n-1..1`) and durations (GIF centiseconds,
  rounded, minimum 2). Transparent pixels stay transparent.
- `export_sheet` accepts an animation root in `assetIds` and expands it to its
  frames in order.
- The guide (`read_guide`, `bitwright://guide/*`) gains an "Animating" page:
  draw frame 1 through the workflow, `add_frame` (copy) per pose, change what
  moves, keep the palette, check every frame's gates, export a GIF or sheet.

## Frontend

- `types/animation.ts`: `Frame`, `Animation`, `Playback`; `Asset` gains
  `rootId: string | null` and `frames: number`.
- `lib/animation.ts`: one bridge function per command above
  (`animationRead`, `frameAdd`, `frameDelete`, `frameMove`, `frameSetDuration`,
  `animationSetDuration`, `animationSetPlayback`, `exportGif`) returning
  `ShellResult`, plus `onAnimationChanged(handler)`.
- `stores/useAnimationStore.ts`:
  `animation: Animation | null`, `playing: boolean`, `playhead: number`
  (index into frames while playing), `onionSkin: boolean`,
  `load(assetId)`, `add(copy)`, `remove(assetId)`, `move(assetId, to)`,
  `setDuration(assetId, ms)`, `setFps(fps)`, `setPlayback(mode)`, `play()`,
  `pause()`, `toggleOnionSkin()`, `select(assetId)` (opens that frame in the
  editor through `useProjectStore.openAsset`), `subscribe()`/`dispose()`.
  It reloads when `useDocumentStore.assetId` changes and on
  `document://animation`. Playback advances `playhead` on each frame's own
  duration, following the playback mode, and stops when the document closes.
- `useEditorStore.bottomPanel: 'timeline' | 'steps' | null` replaces
  `showStepsStrip` (persisted; default `'steps'`). The header has **Timeline
  (n)** (Film) and **Steps (n/11)** toggles; pressing the active one hides the
  panel, pressing the other switches to it.

### Timeline strip (`features/editor/timeline/TimelineStrip.tsx`)

The reference layout's own timeline, one to one:

```
div.h-40 bg-neutral-950 border-t border-neutral-800 flex flex-col shrink-0 select-none
 bar h-10 px-3 border-b border-neutral-800/80 bg-neutral-900/50 flex items-center justify-between text-xs text-neutral-300
  left space-x-2:
   "Playback :" text-[11px] text-neutral-400 + group flex bg-neutral-900 border border-neutral-800 rounded p-0.5 of w-6 h-5 rounded text-[11px] font-semibold buttons → ← ↔ (on bg-pink-600 text-white; off text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800)
   pl-2 border-l border-neutral-800: w-6 h-6 rounded bg-neutral-900 border border-neutral-700 checkerboard-pattern p-0.5 live preview canvas + "Frame i / n :" text-[11px] text-neutral-400 + frame name text-[11px] font-medium text-pink-400
   pl-3 border-l: "FPS:" text-[11px] font-medium text-neutral-400 + range w-20 h-1.5 bg-neutral-800 accent-pink-500 (1..=24) + "8 FPS" text-[11px] text-neutral-200 w-10
   pl-3 border-l: "Frame:" + input w-14 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[11px] (ms) + "ms" text-neutral-500
  right space-x-2:
   Play/Pause px-3 py-1 rounded font-semibold text-xs bg-pink-600 hover:bg-pink-500 border border-pink-500 text-white shadow-sm shadow-pink-600/30 (Play fill-current / Pause)
   Onion Skin px-2.5 py-1 rounded text-xs border (off bg-neutral-900 text-neutral-400 border-neutral-800; on bg-sky-600 text-white border-sky-400) Eye icon
   divider h-4 w-px bg-neutral-800; Duplicate frame (Copy) p-1 rounded; Delete frame (Trash2, hover red, disabled on the last frame)
 strip flex-1 overflow-x-auto p-3 flex items-center space-x-2.5
  card group relative flex-shrink-0 flex flex-col items-center cursor-pointer rounded p-1 border
    current: bg-neutral-900 border-pink-500 shadow-md shadow-pink-500/10 ring-1 ring-pink-500 ; other: bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900
    label "# n" text-[10px] (current text-pink-400 font-semibold, else text-neutral-500) + the frame's step as a tiny badge
    thumbnail w-16 h-16 rounded bg-neutral-950 border border-neutral-800 checkerboard-pattern p-1 (composite of that frame)
    hover footer absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950/80: ChevronLeft / ChevronRight move
  add button flex-shrink-0 w-19 h-full rounded border-2 border-dashed border-neutral-800 hover:border-neutral-600 "+ Add" (adds a copy of the current frame)
```

Clicking a card opens that frame. During playback the stage shows the
playhead frame's composite over the canvas (drawing is disabled while
playing); the bar's mini preview always animates while playing. Onion skin
draws the previous frame's composite at 30% opacity (and the next at 15%)
under the current frame's pixels on the stage.

### Elsewhere

- Home cards: non-root frames are not listed; a root with `frames > 1` shows
  the reference's pink "n frames" badge top-right (the step badge moves beside
  the size badge bottom-left); sort by Frames joins Recent, Name, Size, Kind.
- Export dialog: an animation offers GIF (scale, playback and durations as
  stored) and "Sprite sheet of the frames" in addition to PNG of this frame.
- Duplicating/deleting the open frame opens the neighbour that takes its place.
