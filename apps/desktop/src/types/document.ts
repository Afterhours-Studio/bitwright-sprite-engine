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
 * words. A layer role, a step, an asset kind and a style preset are all closed
 * unions, so a typo is a compile error here instead of an
 * `document.invalid_role` an hour later.
 *
 * Rust's `AssetId` and `LayerRole` are newtypes over a `Uuid` and a `&'static
 * str`, and serde writes a newtype struct as its inner value, so both are
 * plain strings on the wire.
 */

/**
 * A style preset, which is the rule set a project is created against.
 *
 * `custom` exists so that a project can be created with the default rules and
 * then have them edited without the preset name becoming a lie.
 */
export type StylePreset = 'hd2d' | 'snes' | 'gameboy' | 'custom';

/** Every preset, in the order the interface offers them. */
export const STYLE_PRESETS: readonly StylePreset[] = ['hd2d', 'snes', 'gameboy', 'custom'];

/**
 * The preset a new project starts on.
 *
 * HD-2D, because it is the style this application's gates, ramps and step order
 * were written from; the other three are that ruleset with a tighter ceiling.
 */
export const DEFAULT_PRESET: StylePreset = 'hd2d';

/**
 * The canvas each preset creates its assets at.
 *
 * Mirrors `StyleRules::preset` in `raster/palette.rs`, where every preset today
 * inherits the default 48 by 64. It is written out per preset rather than as
 * one constant because the presets are what will diverge - a Game Boy sprite
 * sheet is not a 48 by 64 canvas - and because there is no command that reads a
 * style's rules, so the interface cannot ask. When one exists this table goes.
 */
export const PRESET_CANVAS: Readonly<Record<StylePreset, Canvas>> = {
  hd2d: { width: 48, height: 64 },
  snes: { width: 48, height: 64 },
  gameboy: { width: 48, height: 64 },
  custom: { width: 48, height: 64 },
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
}

/** A style: a preset name and the rules it expanded into. */
export interface Style {
  id: string;
  /** The project it belongs to, or null for a style shared across projects. */
  projectId: string | null;
  name: string;
  preset: StylePreset;
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
  /** Where this asset is in the workflow. */
  step: Step;
  createdAt: number;
  updatedAt: number;
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
  pillowCorrelation: number;
  lightVectors: number[];
  lightMeanDegrees: number | null;
  lightStdDegrees: number | null;
}

/**
 * Whether the current step's work would pass.
 *
 * `issues` holds stable reason codes from the `gate.*` family, not prose, so
 * the text is chosen in the reading language rather than in Rust.
 */
export interface GateReport {
  step: Step;
  passed: boolean;
  issues: string[];
  metrics: GateMetrics;
}

/** Where an asset is in the workflow, and whether it may move on. */
export interface StepState {
  assetId: string;
  step: Step;
  canAdvance: boolean;
  gate: GateReport;
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
