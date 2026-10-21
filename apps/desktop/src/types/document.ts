// Bitwright - Sprite Engine
// Copyright (C) 2026 Afterhours Studio
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

/**
 * The document model, as it crosses the IPC boundary.
 *
 * These mirror `src-tauri/src/store/models.rs`, `src-tauri/src/raster/mod.rs`,
 * `raster/palette.rs` and `raster/document_ops.rs`, and they are written from
 * what those files actually serialise rather than from the prose in
 * `docs/architecture/document-model.md`. The two agree almost everywhere, and
 * where they do not the Rust side wins, because it is the thing on the other
 * end of the wire. Each difference is noted where it occurs.
 *
 * Nothing here is a plain `string` where Rust accepts only a fixed set of
 * words. A layer role, a step, an asset kind and a style era are all closed
 * unions, so a typo is a compile error here instead of an
 * `document.invalid_role` an hour later.
 *
 * Rust's `AssetId` and `LayerRole` are newtypes over a `Uuid` and a `&'static
 * str`, and serde writes a newtype struct as its inner value, so both are
 * plain strings on the wire.
 */

/**
 * The colour and outline rules a project is created against, named for the
 * bit depth of the era they come from.
 *
 * `custom` exists so that a project can start from the default rules and then
 * have them edited without the era name becoming a lie.
 */
export type StyleEra = '8bit' | '16bit' | '32bit' | 'custom';

/**
 * The shape and proportions a project's sprites are drawn in. Isometric is left
 * out until the tilemap has diamond cells for a gate to measure.
 */
export type StyleView = 'topdown' | 'sideview';

/**
 * A style's body proportions: `chibi` (a big head and raised small details)
 * widens the silhouette gates' shape bands.
 */
export type StyleProportions = 'standard' | 'chibi';

/**
 * How a style draws its line, which decides where the outline step sits.
 *
 * `derived` takes each line pixel's colour from the fill beside it, so the
 * outline comes after light. `single` is the hand-drawn order for one-colour
 * line styles: the line straight after the silhouette, then flats, shadow and
 * light inside it, with the line composited above every fill.
 */
export type LineMode = 'derived' | 'single';

/** Every line mode, in the order the interface offers them. */
export const LINE_MODES: readonly LineMode[] = ['derived', 'single'];

/** The line mode a new project starts on, and the one every older style has. */
export const DEFAULT_LINE_MODE: LineMode = 'derived';

/** Every era, in the order the interface offers them. */
export const STYLE_ERAS: readonly StyleEra[] = ['8bit', '16bit', '32bit', 'custom'];

/** Every proportions choice, in the order the interface offers them. */
export const STYLE_PROPORTIONS: readonly StyleProportions[] = ['standard', 'chibi'];

/** Every view, in the order the interface offers them. */
export const STYLE_VIEWS: readonly StyleView[] = ['topdown', 'sideview'];

/** The era a new project starts on: the one this application's gates were written from. */
export const DEFAULT_ERA: StyleEra = '32bit';

/** The view a new project starts on. */
export const DEFAULT_VIEW: StyleView = 'topdown';

/** The proportions a new project starts on. */
export const DEFAULT_PROPORTIONS: StyleProportions = 'standard';

/** A project's style, as the three axes the user chose. */
export interface StyleChoice {
  era: StyleEra;
  view: StyleView;
  proportions: StyleProportions;
}

/** The default style for a project that has none recorded. */
export const DEFAULT_STYLE: StyleChoice = {
  era: DEFAULT_ERA,
  view: DEFAULT_VIEW,
  proportions: DEFAULT_PROPORTIONS,
};

/** What an asset is for. Decides nothing yet; tiles and tilesets grow in phase 4. */
export type AssetKind = 'character' | 'prop' | 'tile' | 'tileset' | 'background';

/** Every kind, in the order the interface offers them. */
export const ASSET_KINDS: readonly AssetKind[] = [
  'character',
  'prop',
  'tile',
  'tileset',
  'background',
];

/**
 * The default canvas for a kind in an era and a view.
 *
 * Mirrors `StyleRules::for_style` in `raster/palette.rs`. It is a table here
 * because the new sprite dialog needs a size before any style row is read. A
 * tileset uses the tile size, and `custom` starts as `32bit`.
 */
const ERA_CANVAS: Readonly<
  Record<
    Exclude<StyleEra, 'custom'>,
    Record<StyleView, Record<'character' | 'prop' | 'tile' | 'background', Canvas>>
  >
> = {
  '8bit': {
    topdown: {
      character: { width: 16, height: 16 },
      prop: { width: 16, height: 16 },
      tile: { width: 8, height: 8 },
      background: { width: 160, height: 144 },
    },
    sideview: {
      character: { width: 16, height: 16 },
      prop: { width: 16, height: 16 },
      tile: { width: 8, height: 8 },
      background: { width: 160, height: 144 },
    },
  },
  '16bit': {
    topdown: {
      character: { width: 32, height: 48 },
      prop: { width: 32, height: 32 },
      tile: { width: 16, height: 16 },
      background: { width: 256, height: 224 },
    },
    sideview: {
      character: { width: 32, height: 32 },
      prop: { width: 32, height: 32 },
      tile: { width: 16, height: 16 },
      background: { width: 256, height: 224 },
    },
  },
  '32bit': {
    topdown: {
      character: { width: 48, height: 64 },
      prop: { width: 48, height: 48 },
      tile: { width: 32, height: 32 },
      background: { width: 320, height: 240 },
    },
    sideview: {
      character: { width: 48, height: 48 },
      prop: { width: 48, height: 48 },
      tile: { width: 32, height: 32 },
      background: { width: 320, height: 240 },
    },
  },
};

/** The canvas a new asset of `kind` is created at in this era and view. */
export function styleCanvas(era: StyleEra, view: StyleView, kind: AssetKind): Canvas {
  const row = ERA_CANVAS[era === 'custom' ? '32bit' : era][view];
  return row[kind === 'tileset' ? 'tile' : kind];
}

/**
 * A step in the workflow, which is where an asset currently is.
 *
 * The order is the order of `STEPS` in `store/models.rs`, and it is the drawing
 * order from the style guide rather than an obvious one: shadow before light,
 * outline after the fills it borders, cleanup last of all.
 */
export type Step =
  | 'reference'
  | 'palette'
  | 'silhouette'
  | 'flats'
  | 'shadow'
  | 'light'
  | 'outline'
  | 'detail'
  | 'accent'
  | 'cleanup'
  | 'variation';

/** Every step, in workflow order. */
export const STEPS: readonly Step[] = [
  'reference',
  'palette',
  'silhouette',
  'flats',
  'shadow',
  'light',
  'outline',
  'detail',
  'accent',
  'cleanup',
  'variation',
];

/**
 * The line-first order of a `single` line style: the same steps, with the
 * outline moved up to straight after the silhouette. Mirrors
 * `LINE_FIRST_STEPS` in `store/models.rs`.
 */
export const LINE_FIRST_STEPS: readonly Step[] = [
  'reference',
  'palette',
  'silhouette',
  'outline',
  'flats',
  'shadow',
  'light',
  'detail',
  'accent',
  'cleanup',
  'variation',
];

/** The step order a style with this line mode works through. */
export function stepsFor(lineMode: LineMode | undefined): readonly Step[] {
  return lineMode === 'single' ? LINE_FIRST_STEPS : STEPS;
}

/**
 * A layer role. One step owns one role, which is why a document holds at most
 * one layer per role.
 *
 * Two steps appear nowhere here. `cleanup` anti-aliases the layers that already
 * exist, and `variation` forks the asset with a new palette; neither paints a
 * layer of its own.
 */
export type LayerRole =
  | 'silhouette'
  | 'flats'
  | 'shadow-core'
  | 'shadow-deep'
  | 'light'
  | 'outline'
  | 'detail'
  | 'rim'
  | 'accent';

/**
 * Every role with the ordinal it composites at, low first.
 *
 * Mirrors `LAYER_ROLES` in `raster/mod.rs`. The ordinals are not contiguous on
 * purpose: they leave room between the bands so a later role can be inserted
 * without renumbering an op log that already names them.
 */
export const LAYER_ROLES: readonly { role: LayerRole; ordinal: number }[] = [
  { role: 'silhouette', ordinal: 10 },
  { role: 'flats', ordinal: 20 },
  { role: 'shadow-core', ordinal: 30 },
  { role: 'shadow-deep', ordinal: 31 },
  { role: 'light', ordinal: 40 },
  { role: 'outline', ordinal: 50 },
  { role: 'detail', ordinal: 60 },
  { role: 'rim', ordinal: 70 },
  { role: 'accent', ordinal: 71 },
];

/**
 * The layer roles each step owns, in the order the step fills them.
 *
 * Mirrors the table in `document-model.md` §6 and the `match` on the step name
 * in `store/workflow.rs`, which is the thing that actually decides which
 * buffers a step's gates read.
 *
 * Four steps own nothing. `reference` writes to the reference table and
 * `palette` to the palette table; `cleanup` anti-aliases the layers that
 * already exist and `variation` forks the asset. None of the four paints a
 * layer of its own, which is why drawing is refused while an asset sits on
 * one of them rather than being quietly sent somewhere.
 *
 * Two steps own two roles. The bands are separate layers because each means
 * one thing - `shadow-core` is the first shadow band and `shadow-deep` is
 * occlusion - and a single layer holding both could not be regenerated
 * without losing the other.
 */
export const STEP_ROLES: Readonly<Record<Step, readonly LayerRole[]>> = {
  reference: [],
  palette: [],
  silhouette: ['silhouette'],
  flats: ['flats'],
  shadow: ['shadow-core', 'shadow-deep'],
  light: ['light'],
  outline: ['outline'],
  detail: ['detail'],
  accent: ['rim', 'accent'],
  cleanup: [],
  variation: [],
};

/**
 * What a ramp is made of.
 *
 * Serialised kebab-case by Rust, which is invisible here because every name is
 * one word. It matters for the shading rules: `skin` is the material that
 * rotates warm in shadow rather than cool.
 */
export type Material =
  | 'skin'
  | 'cloth'
  | 'leather'
  | 'metal'
  | 'hair'
  | 'eyes'
  | 'accent'
  | 'stone'
  | 'glass'
  | 'wood'
  | 'custom';

/** Where the key light is, as the eight compass positions an artist would name. */
export type Direction =
  'upper-left' | 'upper-right' | 'lower-left' | 'lower-right' | 'up' | 'down' | 'left' | 'right';

/** Which perimeter pixels an outline writes. */
export type OutlineMode = 'none' | 'selective' | 'full';

/** Whether a pasted grid overwrites what is under it or paints only its gaps. */
export type PasteMode = 'replace' | 'over';

/** The axis a mirror reflects, named after the coordinate it reflects. */
export type Axis = 'x' | 'y';

/** Which figure a `draw_shape` op draws. */
export type Shape = 'line' | 'rect' | 'ellipse' | 'curve';

/** A project: a name, and the style its assets inherit. */
export interface Project {
  /** UUID v7, so identifiers sort by creation. */
  id: string;
  name: string;
  /** The project's default style, or null when it has none. */
  styleId: string | null;
  /** The era of that style, or null when the project has none. */
  era: StyleEra | null;
  /** The view of that style, or null when the project has none. */
  view: StyleView | null;
  /** The body proportions of that style. */
  proportions: StyleProportions;
  /** Unix milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/** How many ramp steps a style will accept. */
export interface RampSteps {
  min: number;
  max: number;
}

/** The default canvas a style's assets are created at. */
export interface Canvas {
  width: number;
  height: number;
}

/**
 * The hue shift a ramp step is checked against, in the units the style guide
 * uses: degrees for hue, a factor for chroma, and OKLCH lightness for the rest.
 *
 * Every field is a closed range rather than a single number, because a style is
 * a band a palette has to sit inside and not a value it has to hit.
 */
export interface HueShift {
  darkerHueDeg: [number, number];
  darkerChromaFactor: [number, number];
  darkerDeltaL: [number, number];
  lighterHueDeg: [number, number];
  lighterChromaFactor: [number, number];
  lighterDeltaL: [number, number];
}

/** What the gates check a document against. Stored as JSON on the style row. */
export interface StyleRules {
  /** Hard ceiling on palette size. Never above 62, the grid alphabet's size. */
  maxSlots: number;
  rampSteps: RampSteps;
  hueShift: HueShift;
  /** Materials that rotate toward red in shadow rather than toward blue. */
  warmShadowMaterials: Material[];
  /** Darkest slot, as an OKLCH lightness range. */
  valueFloor: [number, number];
  /** Lightest slot, excepting a one pixel specular. */
  valueCeiling: [number, number];
  /** How far apart two touching slots must read. */
  minEdgeDeltaL: number;
  outline: OutlineMode;
  /** Fraction of the perimeter an outline covers. */
  outlineCoverage: [number, number];
  lightDirection: Direction;
  /** Fraction of the perimeter the rim covers. */
  rimCoverage: [number, number];
  /** Largest fraction of the sprite that may be isolated single pixels. */
  noiseBudget: number;
  canvas: Canvas;
  /** The canvas per kind. A kind that is missing uses `canvas`. */
  canvasByKind?: CanvasByKind;
  /** How the line is drawn, which orders the steps. */
  lineMode?: LineMode;
}

/** A canvas size per asset kind; a kind that is missing falls back to `canvas`. */
export type CanvasByKind = Partial<Record<'character' | 'prop' | 'tile' | 'background', Canvas>>;

/** A style: the era and view it was made from, and the rules they expanded into. */
export interface Style {
  id: string;
  /** The project it belongs to, or null for a style shared across projects. */
  projectId: string | null;
  name: string;
  era: StyleEra;
  view: StyleView;
  /** Which silhouette bands the shape gates read. */
  proportions: StyleProportions;
  rules: StyleRules;
  createdAt: number;
  updatedAt: number;
}

/** An asset: one sprite, at one size, somewhere in the workflow. */
export interface Asset {
  id: string;
  projectId: string;
  /** Overrides the project's default style, or null to inherit it. */
  styleId: string | null;
  name: string;
  kind: AssetKind;
  width: number;
  height: number;
  /** The furthest step this asset has reached. */
  step: Step;
  /**
   * The step being viewed and drawn in: `step`, or an earlier one the step
   * rail selected. Older payloads leave it out.
   */
  activeStep?: Step;
  createdAt: number;
  updatedAt: number;
  /**
   * The root of the animation this asset is a later frame of, or null for a
   * root or a lone sprite. Lists hide rows where this is set, because an
   * animation is named, listed and opened by its root.
   */
  rootId: string | null;
  /**
   * How many frames the animation this asset roots has: at least 1 for a root
   * or a lone sprite, 0 for a non-root frame, which counts toward its root.
   */
  frames: number;
}

/**
 * One palette entry.
 *
 * `index` is 1-based: 0 is reserved for transparent and is not a slot, which is
 * what lets a pixel of 0 mean "nothing here" rather than "the first colour".
 */
export interface PaletteSlot {
  /** 1 to 62. */
  index: number;
  /** Straight sRGB bytes, the form a PNG holds and a user types. */
  rgba: [number, number, number, number];
  name: string | null;
  /** The ramp this slot belongs to, by name, or null when it belongs to none. */
  ramp: string | null;
  /** Position within that ramp, 0 being the darkest. */
  step: number | null;
}

/**
 * A run of related slots, darkest first.
 *
 * This is the unit the shading tools work in: an op names a place and the
 * engine steps along the ramp the place is already painted with, which is what
 * stops an agent from ever naming a colour of its own.
 */
export interface Ramp {
  /** Such as `skin`, `cloth-red`, `metal-gold`. */
  name: string;
  material: Material;
  /** Slot indices, darkest first. */
  slots: number[];
}

/** Every colour a document may use. */
export interface Palette {
  slots: PaletteSlot[];
  ramps: Ramp[];
}

/**
 * One layer's pixels, as palette indices rather than colours.
 *
 * `data` is `width * height` bytes, row major, and arrives as a JSON number
 * array because that is what Tauri makes of a `Vec<u8>`.
 */
export interface IndexedBuffer {
  width: number;
  height: number;
  data: number[];
}

/** A composited preview, in straight sRGB bytes. */
export interface RgbaImage {
  width: number;
  height: number;
  /** `width * height * 4` bytes, row major. */
  data: number[];
}

/** One layer of a document. */
export interface Layer {
  id: string;
  role: LayerRole;
  /** Composite order, low first. */
  ordinal: number;
  visible: boolean;
  locked: boolean;
  /** 0 to 1. A preview affordance; an export has no partial alpha. */
  opacity: number;
  buffer: IndexedBuffer;
}

/** A whole open document. */
export interface Document {
  asset: Asset;
  palette: Palette;
  /** Sorted by ordinal. */
  layers: Layer[];
}

/** A rectangle, given as a corner and a size. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangle a shading op may write inside.
 *
 * Spelled `w`/`h` rather than reusing {@link Bounds}, because this is the shape
 * the MCP contract publishes and the Rust `Rect` follows it exactly.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point, in canvas coordinates, where `y` grows downward. */
export interface Point {
  x: number;
  y: number;
}

/** One pixel set to one slot. */
export interface PixelSet {
  x: number;
  y: number;
  slot: number;
}

/**
 * A horizontal span, inclusive of both ends.
 *
 * Both endpoints are stated rather than a start and a length, because a run
 * that names where it stops cannot be placed one pixel wrong by a caller that
 * miscounted.
 */
export interface Run {
  y: number;
  x0: number;
  x1: number;
  slot: number;
}

/**
 * Everything a write to a document can be.
 *
 * Discriminated on `kind`, with the snake_case tags serde emits, because the op
 * log stores this union and a log replayed years from now should not depend on
 * a reader guessing what it is looking at.
 *
 * Every field that Rust marks `#[serde(default)]` is optional here, so that a
 * caller states only what it means. Three shapes differ from the prose in the
 * document model, and follow Rust: `draw_shape` sends `pixelPerfect` rather
 * than `pixel_perfect`, and `shade.direction` and `outline.mode` are optional
 * rather than required, because a call is allowed to inherit the project's.
 */
export type Op =
  | {
      kind: 'paste_grid';
      layer: LayerRole;
      x: number;
      y: number;
      /** One string per row, in the grid alphabet. */
      rows: string[];
      /** Defaults to `replace`. */
      mode?: PasteMode;
    }
  | { kind: 'draw_runs'; layer: LayerRole; runs: Run[] }
  | { kind: 'set_pixels'; layer: LayerRole; pixels: PixelSet[] }
  | {
      kind: 'draw_shape';
      layer: LayerRole;
      shape: Shape;
      from: Point;
      to: Point;
      slot: number;
      /** Defaults to false. Ignored by a line and a curve. */
      fill?: boolean;
      /** Defaults to true, because a doubled diagonal corner is the tell of machine-drawn art. */
      pixelPerfect?: boolean;
    }
  | {
      kind: 'fill_region';
      layer: LayerRole;
      x: number;
      y: number;
      slot: number;
      /** Defaults to true, because repainting the whole canvas is rarely meant. */
      contiguous?: boolean;
    }
  | { kind: 'mirror'; layer: LayerRole; axis: Axis; about?: number }
  | { kind: 'translate'; layer: LayerRole; dx: number; dy: number }
  | { kind: 'clear'; layer: LayerRole }
  | {
      kind: 'shade';
      /** The band. `shadow-core`, `shadow-deep`, `light` and `rim` each mean one thing. */
      target: LayerRole;
      /** The layer whose slots are stepped along their own ramps. */
      from: LayerRole;
      region?: Rect;
      /** Inherits the project's key light when omitted. */
      direction?: Direction;
      /** Ramp steps to move. Defaults to 1. */
      depth?: number;
    }
  | {
      kind: 'outline';
      from: LayerRole;
      /** Inherits the style's outline mode when omitted. */
      mode?: OutlineMode;
      /** Ramp steps to darken by. Defaults to 1. */
      darken?: number;
      /** A single line style's one line slot. Ignored by a derived outline. */
      slot?: number;
    }
  | { kind: 'antialias'; layer: LayerRole; strength?: number };

/**
 * What one op changed, and the bytes it overwrote.
 *
 * `skipped` counts the pixels a shading op could not resolve, which is the
 * signal that something is painted with a slot belonging to no ramp.
 */
export interface Edit {
  changed: number;
  bounds: Bounds | null;
  /** The prior contents of `bounds`, which is what undo replays. */
  prior: number[];
  skipped: number;
}

/** What a batch of ops changed, and where the op log now stands. */
export interface OpResult {
  changed: number;
  bounds: Bounds | null;
  /** The roles that moved, which is what the renderer re-reads. */
  roles: LayerRole[];
  /** The op log sequence after the batch committed. */
  seq: number;
}

/**
 * One measurement a gate made.
 *
 * `name` is a stable kebab-case check name and is the only part of this that
 * may be matched on. `detail` and `hint` are English prose written in Rust
 * beside the measurement that produced them, and are NOT localised: a hint
 * that names the coordinates it found can only be assembled where the pixels
 * were counted, and a reason code chosen here instead would have to throw
 * those coordinates away. There are no `gate.*` reason codes any more.
 *
 * `hint` is present only on a check that failed, because a hint is advice
 * about what to do next and a check that passed has nothing to advise.
 */
export interface GateCheck {
  /** Stable, kebab-case, such as `single-region` or `reads-at-1x`. */
  name: string;
  pass: boolean;
  /** What was measured, in prose. Not localised. */
  detail?: string;
  /** What to do about it, naming coordinates where it can. Not localised. */
  hint?: string;
}

/**
 * Where a region sits, so a report can point at the pixels to repaint rather
 * than only saying that something is wrong.
 *
 * Spelled `width`/`height` rather than the `w`/`h` that {@link Rect} uses,
 * because Rust's `RegionBounds` and Rust's `Rect` disagree about that and this
 * mirrors the first of them.
 */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Filled pixels in the region, which is not `width * height`. */
  area: number;
}

/**
 * What the gates measured.
 *
 * Reported whether or not the gate passed, because the numbers are how a
 * failure is acted on: "too many regions" is advice, `regionSizes` is the
 * thing that says which ones.
 */
export interface GateMetrics {
  filled: number;
  regionSizes: number[];
  perimeter: number;
  perimeterSquaredOverArea: number;
  solidity: number;
  orphanCount: number;
  orphanFraction: number;
  speckleFraction: number;
  jaggySequences: number;
  /** Horizontal colour changes per filled pixel, which is how busy reads. */
  horizontalChangeRate: number;
  pillowCorrelation: number;
  lightVectors: number[];
  lightMeanDegrees: number | null;
  lightStdDegrees: number | null;
  /**
   * Regions that are shaded but whose shading points nowhere.
   *
   * Reported rather than dropped, because a missing light vector reads as
   * consent to every downstream check that only looks at the vectors it was
   * given.
   */
  undirectedRegions: RegionBounds[];
}

/**
 * Whether the current step's work would pass.
 *
 * Every check the step ran is reported, the ones that passed included, because
 * a reader who can only see what broke cannot tell a gate that verified the
 * work from one that never looked.
 */
export interface GateReport {
  step: Step;
  pass: boolean;
  checks: GateCheck[];
  metrics: GateMetrics;
}

/**
 * Where an asset is in the workflow, and whether it may move on.
 *
 * Two steps at once: `step` is the furthest reached, and every step before it
 * has passed; `activeStep` is the one being viewed and drawn in. Selecting an
 * earlier step is a view change and never un-passes or locks anything.
 */
export interface StepState {
  assetId: string;
  /** The furthest step reached. */
  step: Step;
  /** The step viewed and drawn in. Older payloads leave it out. */
  activeStep?: Step;
  /** The style's line mode, which decides `order`. */
  lineMode?: LineMode;
  /** Every step, in the order this style works through them. */
  order?: Step[];
  /** Passed steps an earlier edit asks to check again before the next advance. */
  needsRecheck?: Step[];
  /** The layers the canvas shows at this view. */
  visibleRoles?: LayerRole[];
  /** Whether the furthest step's gate passes and it has a successor. */
  canAdvance: boolean;
  /** The gate of the active step. */
  gate: GateReport;
  /** What an advance re-ran from `needsRecheck` first. */
  rechecked?: GateReport[];
}

/** Emitted after any write, from either actor. Names roles, never pixels. */
export interface ChangedEvent {
  assetId: string;
  roles: LayerRole[];
  seq: number;
}

/** Emitted when a palette is edited. */
export interface PaletteEvent {
  assetId: string;
}

/** Emitted when a step advances or a gate is re-evaluated. */
export interface StepEvent {
  assetId: string;
  step: Step;
  gate: GateReport;
}

/** Emitted when an MCP tool call starts. */
export interface AgentActivityEvent {
  sessionId: string;
  tool: string;
  assetId: string;
}

/** Emitted when an MCP client connects or disconnects. */
export interface AgentSessionEvent {
  sessionId: string;
  state: string;
}
