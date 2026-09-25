# Studio layout (1.1)

The interface is rebuilt on a reference pixel-art studio layout, reproduced
one to one in structure, spacing, type and colour, with Bitwright's own name,
features and agent workflow in it. This file is the contract every Phase 4
task builds from. Class strings below are Tailwind 3 and are meant to be used
verbatim.

## Design system

- Font: Manrope Variable (`@fontsource-variable/manrope`), `font-sans`.
- Icons: `lucide-react`, `w-4 h-4` in tool rows and header, `w-3.5 h-3.5` in
  small buttons, `w-3 h-3` in the tiniest.
- Colour scales in `tailwind.config.ts`: `neutral` 50–950 read CSS variables
  (`rgb(var(--neutral-900) / <alpha-value>)`) so `bg-neutral-900/40` works and
  the light theme can invert the scale in `tokens.css`; `pink`, `sky`,
  `purple`, `red`, `amber`, `emerald` are fixed Tailwind values; `white`,
  `black`. Dark values of neutral are Tailwind's: 50 #fafafa, 100 #f5f5f5,
  200 #e5e5e5, 300 #d4d4d4, 400 #a3a3a3, 500 #737373, 600 #525252,
  700 #404040, 800 #262626, 900 #171717, 950 #0a0a0a.
- Role tokens (`surface-*`, `fg-*`, `line-*`, `accent`) stay and are
  re-pointed at the new look, so a component not yet restyled still matches.
- Radii: `rounded` = 4px, `rounded-xl` for dialogs, `rounded-full` avatars.
- Accent use: **pink** = the active tool / primary action / current item;
  **sky** = toggles that are on, export, zoom readout; **purple** = layers.
- Utilities in `global.css`: `.canvas-workspace-bg` (the diagonal checker:
  four 45° gradients of `rgba(255,255,255,0.035)` at 20px on
  `bg-neutral-950`, workspace colour `rgb(16,18,23)`), `.checkerboard-pattern`
  (small checker behind thumbnails), `.pixelated` (`image-rendering:
pixelated`).
- Studio home background `#141414`, home sidebar `#121212`, asset card
  `#1f1f1f`: tokens `--studio-home`, `--studio-home-side`, `--studio-card`,
  used as `bg-studio-home` etc.

## Screens

`useShellStore.screen` is `'home' | 'editor' | 'settings'`. The app opens on
`home`. Opening an asset goes to `editor`; the header's home button goes back.
There is no bezel and no separate title bar: the top bar of each screen is the
window's drag region (`data-tauri-drag-region`) and carries the window
controls at its trailing end (ported from `TitleBar.tsx`).

### Home

```
div.flex h-full w-full bg-studio-home text-neutral-100 select-none overflow-hidden
 aside.w-56 md:w-60 bg-studio-home-side border-r border-neutral-800/80 pt-5 px-5 pb-5 flex flex-col shrink-0
  card (agent)   bg-neutral-800/40 border border-neutral-800/40 hover:bg-neutral-700/40 rounded p-3 mb-5 flex flex-col gap-2.5 shadow-sm
    row: w-8 h-8 rounded-full bg-neutral-700/40 icon(Bot) + text-xs font-semibold text-neutral-300  "Agent connected" / "No agent connected"
    button w-full py-1.5 px-2 rounded bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-semibold text-[11px]  "Connect an agent" -> settings (MCP)
  actions space-y-1 mb-4, each:
    button group w-full flex items-center space-x-2.5 px-3 py-2 rounded bg-neutral-800/40 border border-neutral-800/40 hover:bg-neutral-700/40 text-neutral-400 text-xs font-medium
    New sprite (ImagePlus) · New project (FolderPlus) · PNG to Pixel (Images: import a reference into a new sprite)
  div.border-t border-neutral-800/80 my-3
  nav space-y-1: active = bg-gradient-to-r from-pink-600 to-purple-600 text-white font-semibold shadow-xs; idle = bg-neutral-800/30 border border-transparent hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-100
    Recent (House) · Projects (Folder) · Settings (Settings)
  mt-auto pt-4: Language label (Languages h-3.5) text-[11px] font-medium text-neutral-500 + select rounded border border-neutral-800 bg-neutral-900/70 px-3 py-2 pr-8 text-xs text-neutral-300 focus:border-pink-500
  mt-4 pt-4 border-t border-neutral-800/60 text-[11px] text-neutral-500: "Bitwright © 2026" / text-[10px] text-neutral-600 "Afterhours Studio · v<appVersion>"
 main.flex-1 flex flex-col min-w-0 overflow-y-auto bg-studio-home p-6 lg:p-8
  head flex items-center justify-between pb-3 border-b border-neutral-800/60: h1 text-base font-semibold text-neutral-100 + list/grid toggles (p-1.5 rounded; on = bg-neutral-800 text-white)
  bar flex flex-wrap items-center justify-between gap-4 py-3 text-xs text-neutral-400: Sort <select bare> (Recent · Name · Size · Kind) | divider | ArrowDown/ArrowUp direction ; Filter <input bg-transparent border-b border-neutral-700 italic w-36 sm:w-48 placeholder "Type to filter">
  grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 pt-2, card:
    div.relative aspect-square bg-studio-card border border-neutral-800/80 hover:border-pink-500/50 rounded overflow-hidden flex items-center justify-center p-3
      thumbnail (composite, pixelated, group-hover:scale-105)
      bottom-1.5 left-1.5 badge rounded bg-black/75 text-[9px] text-neutral-300 border border-neutral-700/50  "24 x 24"
      top-1.5 right-1.5 badge rounded bg-pink-950/80 text-[9px] font-medium text-pink-400 border border-pink-700/50  step name (e.g. "Flats")
      bottom-1.5 right-1.5 delete button (Trash2) opacity-0 group-hover:opacity-100, confirms first
    name text-xs text-neutral-300 group-hover:text-pink-500 truncate / time text-[11px] text-neutral-500 (relative)
```

The Projects view is the same grid grouped under one heading per project
(rename, delete, style preset), which is where everything the old project
sidebar did lives now. List view is a table of the same rows.

### New sprite dialog (from home and the editor header)

`fixed inset-0 bg-black/75 backdrop-blur-sm` → panel `bg-neutral-950 border
border-neutral-800 rounded-xl max-w-lg shadow-2xl`; head `p-4 border-b
border-neutral-800 bg-neutral-900/50` with icon `text-pink-500` and h2
`text-base font-semibold`; body `p-5 space-y-5`: project select, sprite name
input (`bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5
text-xs`), kind (character · prop · tile · tileset · background) as a row of
small toggles, then the size grid `grid grid-cols-2 gap-1.5` of cards (`p-2.5
rounded border`, size in `text-xs font-semibold text-pink-400`, px in
`text-[10px] text-neutral-500`, use-case line `text-[10px] text-neutral-400`;
selected `bg-neutral-900 border-pink-500 ring-1 ring-pink-500/50`) — 16, 24,
32, 48, 64, 96, 128, 192, 256, 512 and Custom (16–512, `col-span-2`), with the
project preset's size marked "Preset" — and the submit `w-full py-2.5
bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs rounded`
"Create sprite (32x32 px)".

### Editor

```
div.flex flex-col h-full w-full overflow-hidden bg-neutral-950 text-neutral-100
 header.h-14 bg-neutral-950 border-b border-neutral-800 px-4 flex items-center justify-between shrink-0   (drag region)
 div.flex flex-1 overflow-hidden relative
  aside  tools            w-64 border-r
  div    stage            relative flex-1 canvas-workspace-bg
  div.flex               colour panel w-64 border-l · layers panel w-64 border-l (toggle)
 div.h-40 timeline or steps strip   border-t (toggle, one at a time)
```

**Header**, left group `space-x-3`:

- home button `p-1.5 rounded bg-pink-600 hover:bg-pink-500 border
border-pink-500 text-white shadow-md shadow-pink-600/20` (House), divider
  `h-4 w-px bg-neutral-800`, label `font-semibold text-sm tracking-tight
text-neutral-200` "Bitwright Studio".
- name box `bg-neutral-900 border border-neutral-800 hover:border-neutral-700
px-2.5 py-1 rounded`: rename input `bg-transparent text-sm font-medium
text-neutral-200 w-44` + size chip `text-[10px] text-pink-400 bg-neutral-800
px-2 py-0.5 rounded border border-neutral-700/60` "24 x 24" (read only: a
  size is fixed at creation).

Middle group `space-x-1.5`, icon buttons `p-1.5 rounded border` (idle `border-neutral-800 bg-neutral-900 text-neutral-400`, disabled `bg-neutral-900/40 text-neutral-600 border-neutral-800/40 cursor-not-allowed`, on `bg-sky-600 text-white border-sky-400`):
Undo (Undo2) · Redo (Redo2) · Clear active layer (BrushCleaning, hover red) ·
divider · pixel grid (Grid3x3, on = sky) · tile guide select (`w-20 rounded
px-2 py-1.5 bg-neutral-800 border border-neutral-700 text-xs`: Tile off, 8,
16, 24, 32, 48, 64) · divider · text toggles `px-2.5 py-1.5 text-xs
font-medium rounded border bg-neutral-800 text-neutral-200 border-neutral-700`
(off: `bg-neutral-900 text-neutral-500 border-neutral-800`): **Layer**
(Layers) toggles the layers panel, **Timeline (n)** (Film) and **Steps
(n/11)** (ListChecks) share the bottom panel — pressing the one that is
showing hides it, pressing the other switches to it — and **Agent** (Brain)
opens the agent popover: MCP state, the live
activity of an agent drawing, and the client-config shortcut.

Right group `space-x-2`: **New** (Plus) `px-3 py-1.5 rounded text-xs
bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border
border-neutral-800` → new sprite dialog; **Reference** (ImageUp, `text-sky-400`
icon) → the reference panel in a dialog; **Export File** (Download) `bg-sky-600
hover:bg-sky-500 border border-sky-400 text-white shadow-md shadow-sky-600/30`
→ export dialog; notifications bell; avatar-style round button `p-2
rounded-full bg-gradient-to-tr from-pink-600 to-purple-600` (Settings) →
settings; window controls.

**Tools column** `w-64 bg-neutral-950 border-r border-neutral-800 flex
flex-col h-full shrink-0 overflow-y-auto`:

- head `p-3 border-b border-neutral-800/80 bg-neutral-900/40 flex
justify-between`: "Tools" `text-xs font-semibold uppercase tracking-wider
text-neutral-400`, "Shortcuts" `text-[10px] text-neutral-500`.
- list `p-2 space-y-1`, row `w-full flex items-center justify-between px-2.5
py-1.5 rounded text-left`: icon `w-4 h-4`, name `text-xs leading-tight`,
  hint `text-[9px] leading-tight truncate`, key `kbd ml-1 px-1.5 py-0.5
text-[10px] rounded`. Active: `bg-pink-600 hover:bg-pink-500 border
border-pink-500 text-white shadow-md shadow-pink-600/20 font-semibold`, hint
  `text-pink-200`, kbd `bg-pink-700/80 text-white border border-pink-400/40`.
  Idle: `text-neutral-300 hover:text-white hover:bg-neutral-900/80
bg-neutral-900/20`, icon `text-neutral-400`, hint `text-neutral-500`, kbd
  `bg-neutral-800 text-neutral-400 border border-neutral-700`.
- tools, in order, with keys: Pencil B (Paintbrush), Eraser E, Paint bucket G
  (PaintBucket), Eyedropper I (Pipette), Rectangle select M (SquareDashed),
  Magic wand W (WandSparkles), Move V, Pan H (Hand), Zoom Z (ZoomIn), Line L
  (Minus), Curve Q (Spline), Rectangle U (Square), Circle C, Checker dither J
  (Grid3x3), Lighten O (Sun), Darken K (Moon).
- `h-px bg-neutral-800/80 mx-2.5 my-1`, then Mirror symmetry `p-2 space-y-1.5
pb-3`: label row `text-[11px] font-semibold text-neutral-300` + state
  `text-sky-400`; `grid grid-cols-2 gap-1` of Off · Horizontal
  (SquareSplitVertical) · Vertical (SquareSplitHorizontal) · Both (Plus),
  `py-1 px-1.5 text-[11px] rounded border` on = sky, idle `bg-neutral-900
text-neutral-400 border-neutral-800`.
- A shape tool shows a "Fill" toggle under the list while it is active.

**Stage** `relative flex-1 h-full overflow-hidden canvas-workspace-bg
cursor-crosshair`; the sprite sits in `shadow-2xl ring-1 ring-white/15`.
Floating panels are `bg-neutral-950/90 backdrop-blur border
border-neutral-800 p-1 rounded shadow-md`, buttons `p-1.5 text-neutral-400
hover:text-neutral-100 hover:bg-neutral-800 rounded`:

- top-4 right-4: Flip horizontal · Flip vertical (the `mirror` op on the
  active layer) · divider · Replace secondary with primary (a `set_pixels`
  of every secondary-slot pixel on the active layer) · Outline (the `outline`
  op, `Square` icon) · Anti-alias (the `antialias` op, `Blend`).
- bottom-3 left-3 readout `px-3 py-1.5 flex space-x-3 text-xs
text-neutral-300 pointer-events-none`: cursor `x : y` (or `-- : --`), `|`
  `text-neutral-600`, size `text-pink-400 font-semibold` "24 x 24 px", `|`,
  zoom `text-sky-400 font-semibold` "26 x", and the target layer
  `text-purple-400`.
- bottom-3 right-3 zoom: ZoomOut · `px-2 py-1 text-xs font-medium` "2600 %"
  (click = fit) · ZoomIn.
- top-4 left-4: the agent-activity chip when an agent is drawing.
- A background asset shows `TilemapEditor` on this stage instead.

**Colour panel** `w-64 bg-neutral-950 border-l border-neutral-800 flex
flex-col h-full`:

- head `p-3 border-b border-neutral-800 bg-neutral-900/40`: "Color Palette"
  `text-xs font-semibold text-neutral-300` + tabs `flex space-x-1
bg-neutral-900 p-0.5 rounded border border-neutral-800`, tab `px-2 py-0.5
text-[11px] font-medium rounded` (on `bg-neutral-800 text-white`):
  Swatches · Ramps.
- primary/secondary: `relative w-12 h-10`, secondary `absolute bottom-0
right-0 w-7 h-7 border border-neutral-800`, primary `absolute top-0 left-0
w-8 h-8 ring-1 ring-white z-20`; swap (ArrowLeftRight, key X); slot readout
  `bg-neutral-900 border border-neutral-800 px-2 py-1 rounded`: `PRI`
  `text-[10px] text-neutral-500 uppercase` + `#fcd374` / slot number.
- Brush size `mt-3 pt-2.5 border-t border-neutral-800/80`: label + `text-pink-400`
  value; `grid grid-cols-4 gap-1.5` of 1–4 px cards `py-2 px-1 rounded flex
flex-col items-center` with a dot of that size (on = pink), plus the
  circle/square footprint toggle and a stepper up to 16.
- body `flex-1 overflow-y-auto p-3 space-y-4`: style preset readout; "Colors
  in palette (n)" with Add color (`text-pink-400`) | Remove color
  (`hover:text-red-400`); grid `grid grid-cols-7 gap-1.5 p-2 bg-neutral-900/60
rounded border border-neutral-800/80 max-h-48 overflow-y-auto`, swatch `w-6
h-6 rounded-sm hover:scale-110` (primary `ring-2 ring-white`, secondary
  `ring-2 ring-sky-400`). Left click primary, right click secondary. The
  Ramps tab lists the palette's ramps (material, slots) and editing a slot's
  colour.

**Layers panel** `w-64 ... border-l`, head `p-3 border-b bg-neutral-900/40`:
Layers icon `text-purple-400` + "Layers" `text-xs font-semibold
text-neutral-200` + the step's layer target selector as a `bg-purple-600
hover:bg-purple-500 px-2 py-0.5 rounded text-[11px]` button "Draw on…".
Rows `p-2 rounded border` (current: `bg-neutral-900 border-purple-500/80
shadow-sm shadow-purple-500/10`; idle `bg-neutral-900/40 border-neutral-800`):
Eye/EyeOff, role name, owning step, pixel count; under a divider `mt-2 pt-1.5
border-t border-neutral-800/80` the opacity readout. Layers are the roles the
workflow defines, top first; there is no free "add layer".

**Timeline** — the reference layout's own animation timeline, one to one,
shown in the bottom panel when **Timeline** is on. Its class strings, the
onion skin and playback on the stage are specified in
[animation frames](animation.md#timeline-strip-featureseditortimelinetimelinestriptsx).

**Steps strip** `h-40 bg-neutral-950 border-t border-neutral-800 flex flex-col
shrink-0` — the agent workflow, shown in the bottom panel in place of the
timeline:

- bar `h-10 px-3 border-b border-neutral-800/80 bg-neutral-900/50 flex
justify-between text-xs`: "Step :" `text-[11px] text-neutral-400` + current
  step `text-pink-400 font-medium`, `pl-3 border-l border-neutral-800` gate
  summary (passes / fails counts, `text-emerald-400` / `text-red-400`), the
  step's layer; right: **Check** (`bg-neutral-900 border-neutral-800`),
  **Advance** (`bg-pink-600 hover:bg-pink-500 border border-pink-500 text-white
shadow-sm shadow-pink-600/30`, Play icon `fill-current`), divider, Revisit
  (RotateCcw) and Force advance (behind the existing confirmation).
- strip `flex-1 overflow-x-auto p-3 flex items-center space-x-2.5`, one card per
  step: `group relative flex-shrink-0 flex flex-col items-center rounded p-1
border` (current `bg-neutral-900 border-pink-500 shadow-md
shadow-pink-500/10 ring-1 ring-pink-500`; done `bg-neutral-900/60
border-neutral-800`; later `opacity-60`), label `text-[10px]` "# 3 Flats",
  thumbnail `w-16 h-16 rounded bg-neutral-950 border border-neutral-800
checkerboard-pattern p-1` of that step's layer(s), a check or lock badge.
- The gate report opens in a popover from the summary.

### Settings

Same frame as home (the sidebar with Settings active); the content area uses
the home `main` styling, and the existing cards (MCP, storage, theme,
language, about) are restyled as `bg-neutral-900/40 border border-neutral-800
rounded p-4` sections.

## Keyboard

B E G I M W V H Z L Q U C J O K choose tools; X swaps colours; Ctrl+Z / Ctrl+Y
/ Ctrl+Shift+Z undo and redo; Space held pans; `-`/`+` zoom; `,`/`.` open the
previous and the next frame; Delete clears the
selection's pixels; Escape drops the selection; Ctrl+K the command palette.
Shortcuts are ignored while a text field has focus.

## Tool behaviour

Everything is still an op on the document, one batch per stroke, one undo
per batch; nothing paints locally except the preview.

- Pencil / eraser / dither: client pixels → `set_pixels`. Dither writes the
  primary slot on `(x + y) % 2 == 0` cells and the secondary on the rest.
- Lighten / darken: each stroked pixel moves one step along its slot's ramp
  (up = lighter), read from the palette's ramps; a slot in no ramp is left.
- Fill: `fill_region`; with a selection, a client flood fill clipped to it →
  `set_pixels`.
- Eyedropper: the active layer's slot under the cursor becomes primary (right
  click: secondary); transparent picks nothing.
- Rectangle select / magic wand: a selection mask held in the editor store
  (wand: contiguous same slot on the active layer; Shift: every such pixel).
  While a selection exists, every pixel tool is clipped to it, shapes are
  rasterised client-side (`lib/shapes.ts`: line from `linePoints`, rectangle
  as four lines or a filled box, midpoint ellipse, and Rust's cubic elbow curve, each ported
  with Rust's rounding and pixel-perfect pass) and clipped, and the marching-ants
  outline is drawn. Without a selection shapes stay `draw_shape`, so Rust's
  pixel-perfect rasteriser remains the one an agent and a person share.
- Move: with no selection, `translate` the active layer; with one, lift the
  selected pixels and write them at the offset (one `set_pixels` batch).
- Pan / zoom: view only. Zoom click in, Alt click out.
- Symmetry: each client-pixel tool also writes the mirror image about the
  canvas centre on the chosen axes.
