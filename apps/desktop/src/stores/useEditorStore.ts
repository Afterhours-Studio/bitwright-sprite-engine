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
 * What the pixel editor is set to draw with.
 *
 * This is the editor's state, not the toolbar's. The tool rail happens to be
 * where the tool is chosen, and the surface that consumes it is the document
 * canvas, which is why this store is named for the editor and knows nothing
 * about either the bar that sets it or the sprite it will be used on.
 *
 * NOTHING HERE MODIFIES A DOCUMENT. Choosing a tool says what the next stroke
 * would do; it does not make one, and it could not: the only write path is
 * `document_write_ops`, and this store does not import it. That is what allows
 * the picker to sit in an always-visible bar at all, where a control that acted
 * on press would be the easiest thing on screen to hit by accident. The stroke
 * itself is made in `features/editor/canvas`, which reads every setting here
 * once when a drag begins and holds it for the drag's whole length, so changing
 * one mid-drag cannot alter a stroke that is already under way.
 *
 * The tool set is the studio layout's rail (docs/architecture/studio-layout.md),
 * which is the reference studio's set one to one. Each shape is a tool of its
 * own there rather than one tool with a variant, so it is here too: a shape
 * has its own key and its own place on the rail, and a variant held beside a
 * single shape tool would be a second piece of state saying the same thing.
 * `shapeOf` is what turns a shape tool back into the figure the op draws.
 *
 * The four shapes are Pixelorama's shape set exactly, and a subset of
 * Aseprite's group of six. The two left out, polygon and contour, are the ones
 * that need a different input model - repeated clicks to close a path, or a
 * freehand drag - rather than the two corners the other four take.
 *
 * The brush settings sit here for the same reason the tool does: they are a
 * property of the tool, not of the sprite, and Aseprite, Libresprite, Piskel
 * and Pixelorama all put them beside the tool selector rather than in a
 * general purpose panel.
 *
 * The selection is held here too, and not in the document, because it is not
 * part of the sprite: nothing saves it and no op reads it. It changes what the
 * next stroke is allowed to touch, which makes it a property of the editor in
 * the same way the tool is. The canvas clips each stroke to it before the ops
 * are built, so Rust never needs to know a selection exists.
 *
 * The view settings are a different kind of thing again, and they are here
 * rather than with the sprite on purpose. They change what the canvas and the
 * editor frame DRAW; they never change the sprite or anything that is saved.
 * That is also why they outlive the window while nothing else in this store
 * does: they describe how the user likes to look at a canvas, not what happens
 * to be on one.
 */

import { create } from 'zustand';

import { loadValue, saveValue, STORAGE_KEYS } from '@/lib/persist';
import type { LayerRole } from '@/types/document';

/** A tool on the rail. */
export type Tool =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'select'
  | 'wand'
  | 'move'
  | 'pan'
  | 'zoom'
  | 'line'
  | 'curve'
  | 'rectangle'
  | 'ellipse'
  | 'dither'
  | 'lighten'
  | 'darken';

/** The outline a shape tool lays down. */
export type Shape = 'line' | 'curve' | 'rectangle' | 'ellipse';

/** The footprint a brush lays down at sizes above one pixel. */
export type BrushShape = 'circle' | 'square';

/** Which axes a stroke is mirrored about, through the canvas centre. */
export type Symmetry = 'off' | 'horizontal' | 'vertical' | 'both';

/**
 * The tile guide's cell size in sprite pixels, or 0 for no guide.
 *
 * A fixed set rather than any number, because these are the tile sizes sprite
 * sheets and tile maps are actually cut at; a 13 pixel guide lines up with
 * nothing anyone exports.
 */
export type TileGuide = 0 | 8 | 16 | 24 | 32 | 48 | 64;

/**
 * The region every pixel tool is clipped to.
 *
 * A mask over the whole document rather than a rectangle, because the magic
 * wand selects a region of any shape. `mask` holds `width * height` bytes in
 * row order; a non-zero byte is a selected pixel.
 */
export interface Selection {
  width: number;
  height: number;
  mask: Uint8Array;
}

/** The tools, in the order the rail lists them. */
export const TOOLS: readonly Tool[] = [
  'pencil',
  'eraser',
  'fill',
  'eyedropper',
  'select',
  'wand',
  'move',
  'pan',
  'zoom',
  'line',
  'curve',
  'rectangle',
  'ellipse',
  'dither',
  'lighten',
  'darken',
];

/**
 * The key that chooses each tool.
 *
 * Aseprite's letters wherever Aseprite has the tool - B for the pencil, which
 * it calls the brush, G for the bucket, I for the eyedropper, M for the
 * marquee, W for the wand, V for move, H for hand, Z for zoom, L for line, U
 * and C for rectangle and ellipse - so the habits of the editor most pixel
 * artists came from carry over. The rest take a free letter.
 */
export const TOOL_KEYS: Readonly<Record<Tool, string>> = {
  pencil: 'B',
  eraser: 'E',
  fill: 'G',
  eyedropper: 'I',
  select: 'M',
  wand: 'W',
  move: 'V',
  pan: 'H',
  zoom: 'Z',
  line: 'L',
  curve: 'Q',
  rectangle: 'U',
  ellipse: 'C',
  dither: 'J',
  lighten: 'O',
  darken: 'K',
};

/**
 * The tools that draw a shape, in the order the rail lists them.
 *
 * Read as a two by two grid rather than a list: the open paths first, the
 * closed outlines second.
 */
export const SHAPE_TOOLS: readonly Shape[] = ['line', 'curve', 'rectangle', 'ellipse'];

/**
 * The shape a tool draws.
 *
 * @param tool - A tool.
 * @returns The figure it lays down, or null when the tool is not a shape tool.
 */
export function shapeOf(tool: Tool): Shape | null {
  return SHAPE_TOOLS.find((shape) => shape === tool) ?? null;
}

/** The brush footprints, in the order the popover lists them. */
export const BRUSH_SHAPES: readonly BrushShape[] = ['circle', 'square'];

/** The symmetry modes, in the order the panel lists them. */
export const SYMMETRIES: readonly Symmetry[] = ['off', 'horizontal', 'vertical', 'both'];

/** The tile guide sizes, in the order the menu lists them, off first. */
export const TILE_GUIDES: readonly TileGuide[] = [0, 8, 16, 24, 32, 48, 64];

/** The smallest brush. One pixel, which is what a pixel artist draws with. */
export const MIN_BRUSH_SIZE = 1;

/**
 * The largest brush.
 *
 * Sixteen rather than Aseprite's and Libresprite's `kMaxBrushSize = 64`. The
 * sizes anyone uses for sprite work are 1 to 4; the cap only has to be far
 * enough above that to not be in the way, and a 64 pixel brush on a 64 pixel
 * sprite covers the whole canvas in one press.
 */
export const MAX_BRUSH_SIZE = 16;

/**
 * The lowest palette slot, and the highest.
 *
 * Index 0 is reserved for transparent and is not a slot; the ceiling is 62
 * because that is how many symbols the grid alphabet has, and a slot that
 * cannot be named in a readback is a slot an agent cannot see.
 */
export const FIRST_SLOT = 1;
export const MAX_SLOT = 62;

/** The tool a session starts on. */
export const DEFAULT_TOOL: Tool = 'pencil';

/**
 * The secondary slot a session starts on.
 *
 * Slot 2 rather than a copy of the primary, so that the swap key does
 * something visible on first use.
 */
export const DEFAULT_SECONDARY_SLOT = 2;

/** The brush a session starts on: one pixel, the pixel artist's default. */
export const DEFAULT_BRUSH_SIZE = 1;

/** The footprint a session starts on. */
export const DEFAULT_BRUSH_SHAPE: BrushShape = 'circle';

interface EditorState {
  /** The tool the next stroke would use. */
  tool: Tool;
  /** How many sprite pixels across the brush covers. */
  brushSize: number;
  /** The brush's footprint at sizes above one pixel. */
  brushShape: BrushShape;
  /**
   * The palette slot painting writes, 1 to 62.
   *
   * A slot and not a colour. What slot 7 looks like belongs to the palette, so
   * an editor that held a hex value could put a colour on a sprite that its
   * palette does not contain - which is the whole failure indexed pixels exist
   * to make impossible.
   *
   * It starts at 1 rather than at null because slot 1 always exists: a
   * document is created with a palette, and a pencil that refuses to draw
   * until a swatch has been pressed is a tool that does nothing on first use.
   */
  slot: number;
  /**
   * The second palette slot, 1 to 62: what a right click picks into, what the
   * dither tool alternates with, and what the swap key trades with `slot`. A
   * slot rather than a colour for the same reason `slot` is one.
   */
  secondarySlot: number;
  /**
   * Whether the rectangle and ellipse tools lay down a filled figure rather
   * than an outline. The line and the curve have no inside, so they ignore it.
   */
  shapeFill: boolean;
  /** Which axes a stroke is mirrored about. */
  symmetry: Symmetry;
  /**
   * The region pixel tools are clipped to, or null when nothing is selected.
   *
   * Null is not "everything selected" but the ordinary state, in which shapes
   * stay `draw_shape` and are rasterised by Rust.
   */
  selection: Selection | null;
  /**
   * The layer a stroke writes to when it is not the one the step owns, or null
   * to follow the step.
   *
   * Null is the ordinary state. A non-null value is a deliberate override of
   * the workflow - the same act the MCP tools call `force` - and the interface
   * only sets it after asking, because a stray click that repaints a finished
   * layer is exactly what the step order exists to prevent.
   */
  targetRole: LayerRole | null;
  /** Whether the canvas draws a line at every sprite pixel boundary. */
  showPixelGrid: boolean;
  /** Whether the canvas shows transparent pixels as a checker pattern. */
  showCheckerboard: boolean;
  /** The tile guide's cell size, or 0 when it is off. */
  tileGuide: TileGuide;
  /** Whether the layers panel is shown beside the canvas. */
  showLayersPanel: boolean;
  /** Whether the step strip is shown under the canvas. */
  showStepsStrip: boolean;

  /** Chooses the tool. */
  setTool: (tool: Tool) => void;
  /** Sets the brush width, clamped to the supported range. */
  setBrushSize: (size: number) => void;
  /** Chooses the brush footprint. */
  setBrushShape: (shape: BrushShape) => void;
  /** Chooses the palette slot painting writes. */
  setSlot: (slot: number) => void;
  /** Chooses the secondary palette slot. */
  setSecondarySlot: (slot: number) => void;
  /** Trades the primary and the secondary slot. */
  swapSlots: () => void;
  /** Chooses between filled and outlined rectangles and ellipses. */
  setShapeFill: (fill: boolean) => void;
  /** Chooses the mirror axes. */
  setSymmetry: (symmetry: Symmetry) => void;
  /** Replaces the selection. Throws when the mask does not match its size. */
  setSelection: (selection: Selection) => void;
  /** Drops the selection. */
  clearSelection: () => void;
  /** Overrides the layer a stroke writes to, or passes null to follow the step. */
  setTargetRole: (role: LayerRole | null) => void;
  /** Shows or hides the pixel grid overlay. */
  setShowPixelGrid: (show: boolean) => void;
  /** Shows or hides the transparency checkerboard. */
  setShowCheckerboard: (show: boolean) => void;
  /** Sets the tile guide's cell size, or 0 to hide it. */
  setTileGuide: (size: TileGuide) => void;
  /** Shows or hides the layers panel. */
  setShowLayersPanel: (show: boolean) => void;
  /** Shows or hides the step strip. */
  setShowStepsStrip: (show: boolean) => void;
}

/** What the canvas overlays and the editor frame show, as kept between sessions. */
interface ViewPreferences {
  showPixelGrid: boolean;
  showCheckerboard: boolean;
  tileGuide: TileGuide;
  showLayersPanel: boolean;
  showStepsStrip: boolean;
}

/** The view a first run starts with. */
const DEFAULT_VIEW: ViewPreferences = {
  showPixelGrid: true,
  showCheckerboard: true,
  tileGuide: 0,
  showLayersPanel: true,
  showStepsStrip: true,
};

/**
 * Clamps a slot into the range the palette alphabet can name.
 *
 * Clamped in the store rather than trusted from the swatch that was pressed, so
 * the store's own guarantee holds however the value arrives: a slot outside 1
 * to 62 is `document.invalid_buffer` from Rust at write time, which is a long
 * way from the press that caused it.
 *
 * @param slot - The requested slot.
 * @param fallback - What NaN or an infinity becomes.
 * @returns A slot from 1 to 62.
 */
function clampSlot(slot: number, fallback: number): number {
  return Number.isFinite(slot)
    ? Math.min(MAX_SLOT, Math.max(FIRST_SLOT, Math.round(slot)))
    : fallback;
}

/**
 * Reads the stored view.
 *
 * Turning the grid off and finding it back on after a reload is the interface
 * forgetting a decision that was deliberate, so these outlive the window.
 *
 * @returns The stored preferences, with anything missing taken from the
 *   defaults, so a record written by an older version still loads. A stored
 *   tile guide that is not one of the offered sizes falls back to off rather
 *   than drawing a guide no menu entry describes.
 */
function storedView(): ViewPreferences {
  const stored = loadValue(STORAGE_KEYS.view) as Partial<ViewPreferences> | null;
  const view = { ...DEFAULT_VIEW, ...(stored ?? {}) };
  if (!TILE_GUIDES.includes(view.tileGuide)) {
    view.tileGuide = DEFAULT_VIEW.tileGuide;
  }
  return view;
}

/**
 * Writes the view.
 *
 * @param state - The state to take it from.
 */
function remember(state: ViewPreferences): void {
  saveValue(STORAGE_KEYS.view, {
    showPixelGrid: state.showPixelGrid,
    showCheckerboard: state.showCheckerboard,
    tileGuide: state.tileGuide,
    showLayersPanel: state.showLayersPanel,
    showStepsStrip: state.showStepsStrip,
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tool: DEFAULT_TOOL,
  brushSize: DEFAULT_BRUSH_SIZE,
  brushShape: DEFAULT_BRUSH_SHAPE,
  slot: FIRST_SLOT,
  secondarySlot: DEFAULT_SECONDARY_SLOT,
  shapeFill: false,
  symmetry: 'off',
  selection: null,
  targetRole: null,
  // The overlays are on by default. The grid is the thing that tells a viewer
  // where one sprite pixel ends and the next begins, and it suppresses itself
  // whenever it would be a grey wash instead, so leaving it on costs nothing
  // when it is not wanted.
  ...storedView(),

  setTool: (tool) => {
    set({ tool });
  },

  setBrushSize: (size) => {
    // Clamped here rather than trusted from the control, so that the store's
    // own guarantee holds however the value arrives. A number field can hand
    // over an empty string parsed to NaN mid-edit, and NaN survives every
    // comparison it is put through.
    const clamped = Number.isFinite(size)
      ? Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(size)))
      : DEFAULT_BRUSH_SIZE;
    set({ brushSize: clamped });
  },

  setBrushShape: (brushShape) => {
    set({ brushShape });
  },

  setSlot: (slot) => {
    set({ slot: clampSlot(slot, FIRST_SLOT) });
  },

  setSecondarySlot: (slot) => {
    set({ secondarySlot: clampSlot(slot, DEFAULT_SECONDARY_SLOT) });
  },

  swapSlots: () => {
    const { slot, secondarySlot } = get();
    set({ slot: secondarySlot, secondarySlot: slot });
  },

  setShapeFill: (shapeFill) => {
    set({ shapeFill });
  },

  setSymmetry: (symmetry) => {
    set({ symmetry });
  },

  setSelection: (selection) => {
    // Refused rather than stored, because a mask shorter than its size would
    // read as "not selected" past its end and clip strokes nobody asked to
    // clip, far from the code that built the wrong mask.
    const expected = selection.width * selection.height;
    if (selection.mask.length !== expected) {
      throw new RangeError(
        `a ${String(selection.width)}x${String(selection.height)} selection needs ${String(expected)} mask bytes, not ${String(selection.mask.length)}`,
      );
    }
    set({ selection });
  },

  clearSelection: () => {
    set({ selection: null });
  },

  setTargetRole: (targetRole) => {
    set({ targetRole });
  },

  setShowPixelGrid: (showPixelGrid) => {
    set({ showPixelGrid });
    remember(get());
  },

  setShowCheckerboard: (showCheckerboard) => {
    set({ showCheckerboard });
    remember(get());
  },

  setTileGuide: (tileGuide) => {
    set({ tileGuide });
    remember(get());
  },

  setShowLayersPanel: (showLayersPanel) => {
    set({ showLayersPanel });
    remember(get());
  },

  setShowStepsStrip: (showStepsStrip) => {
    set({ showStepsStrip });
    remember(get());
  },
}));
