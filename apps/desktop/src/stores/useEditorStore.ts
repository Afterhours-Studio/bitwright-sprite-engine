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
 * This is the editor's state, not the dock's. The dock happens to be where the
 * tool is chosen today, and the surface that consumes it is `useCanvasStore`,
 * which is why this store is named for the editor and knows nothing about
 * either the bar that sets it or the sprite it will be used on.
 *
 * Nothing here modifies an image. Choosing a tool says what the next stroke
 * would do; it does not make one. That is what allows the picker to sit in an
 * always-visible bar at all, where a control that acted on press would be the
 * easiest thing on screen to hit by accident. The stroke itself is made in
 * `useCanvasStore`, which reads these settings when a drag begins and holds
 * them for its whole length, so changing one mid-drag cannot alter a stroke
 * that is already under way.
 *
 * The tool set is the one every pixel editor agrees on. Aseprite, Libresprite,
 * Piskel and Pixelorama all put a pencil, an eraser, a bucket fill, a
 * rectangular selection and the shape tools on their primary bar, so those are
 * the tools here.
 *
 * There is no colour picker. The main canvas area is split into two
 * containers, and picking a colour belongs there, beside the colour it picks.
 * A second way to reach it from the dock would be a second control for one
 * job, which is what the shape chip and the shape flyout used to be.
 *
 * The shapes are one tool with a variant rather than four tools, which is how
 * Aseprite and Photoshop group them: they share every setting and differ only
 * in the outline they lay down, so they share a slot and the variant is picked
 * from a flyout.
 *
 * The four are Pixelorama's shape set exactly, and a subset of Aseprite's
 * group of six. The two left out, polygon and contour, are the ones that need
 * a different input model - repeated clicks to close a path, or a freehand
 * drag - rather than the two corners the other four take.
 *
 * The brush settings sit here for the same reason the tool does: they are a
 * property of the tool, not of the sprite, and Aseprite, Libresprite, Piskel
 * and Pixelorama all put them beside the tool selector rather than in a
 * general purpose panel.
 *
 * The view settings are a different kind of thing again, and they are here
 * rather than with the sprite on purpose. They change what the canvas DRAWS;
 * they never change the sprite or anything that is saved. That is also why
 * they outlive the window while nothing else in this store does: they describe
 * how the user likes to look at a canvas, not what happens to be on one.
 */

import { create } from 'zustand';

import { loadValue, saveValue, STORAGE_KEYS } from '@/lib/persist';

/** A drawing tool. */
export type Tool = 'pencil' | 'eraser' | 'fill' | 'select' | 'shape';

/** The outline the shape tool lays down. */
export type Shape = 'line' | 'curve' | 'rectangle' | 'ellipse';

/** The footprint a brush lays down at sizes above one pixel. */
export type BrushShape = 'circle' | 'square';

/** The tools, in the order a toolbar lists them. */
export const TOOLS: readonly Tool[] = ['pencil', 'eraser', 'fill', 'select', 'shape'];

/**
 * The shapes, in the order the flyout lists them.
 *
 * Read as a two by two grid rather than a list: the open paths on the first
 * row, the closed outlines on the second.
 */
export const SHAPES: readonly Shape[] = ['line', 'curve', 'rectangle', 'ellipse'];

/** The brush footprints, in the order the popover lists them. */
export const BRUSH_SHAPES: readonly BrushShape[] = ['circle', 'square'];

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

/** The tool a session starts on. */
export const DEFAULT_TOOL: Tool = 'pencil';

/** The shape a session starts on. */
export const DEFAULT_SHAPE: Shape = 'rectangle';

/** The brush a session starts on: one pixel, the pixel artist's default. */
export const DEFAULT_BRUSH_SIZE = 1;

/** The footprint a session starts on. */
export const DEFAULT_BRUSH_SHAPE: BrushShape = 'circle';

interface EditorState {
  /** The tool the next stroke would use. */
  tool: Tool;
  /** The outline the shape tool would lay down. */
  shape: Shape;
  /** How many sprite pixels across the brush covers. */
  brushSize: number;
  /** The brush's footprint at sizes above one pixel. */
  brushShape: BrushShape;
  /**
   * The colour painting uses, as hex, or null when none is chosen.
   *
   * Null rather than a default: a sprite's palette is not known until it has
   * one, and picking white in advance would be the interface inventing a
   * colour the sprite may not contain. What painting falls back to while it is
   * null is `useCanvasStore`'s decision, which is where painting happens.
   */
  colour: string | null;
  /** Whether the canvas draws a line at every sprite pixel boundary. */
  showPixelGrid: boolean;
  /** Whether the canvas shows transparent pixels as a checker pattern. */
  showCheckerboard: boolean;

  /** Chooses the tool. */
  setTool: (tool: Tool) => void;
  /** Chooses the shape, and with it the shape tool. */
  setShape: (shape: Shape) => void;
  /** Sets the brush width, clamped to the supported range. */
  setBrushSize: (size: number) => void;
  /** Chooses the brush footprint. */
  setBrushShape: (shape: BrushShape) => void;
  /** Chooses the colour painting uses. */
  setColour: (colour: string) => void;
  /** Shows or hides the pixel grid overlay. */
  setShowPixelGrid: (show: boolean) => void;
  /** Shows or hides the transparency checkerboard. */
  setShowCheckerboard: (show: boolean) => void;
}

/** What the canvas overlays, as it is kept between sessions. */
interface ViewPreferences {
  showPixelGrid: boolean;
  showCheckerboard: boolean;
}

/** The overlays a first run starts with. */
const DEFAULT_VIEW: ViewPreferences = { showPixelGrid: true, showCheckerboard: true };

/**
 * Reads the stored overlays.
 *
 * Turning the grid off and finding it back on after a reload is the interface
 * forgetting a decision that was deliberate, so these outlive the window.
 *
 * @returns The stored preferences, with anything missing taken from the
 *   defaults, so a record written by an older version still loads.
 */
function storedView(): ViewPreferences {
  const stored = loadValue(STORAGE_KEYS.view) as Partial<ViewPreferences> | null;
  return { ...DEFAULT_VIEW, ...(stored ?? {}) };
}

/**
 * Writes the overlays.
 *
 * @param state - The state to take them from.
 */
function remember(state: ViewPreferences): void {
  saveValue(STORAGE_KEYS.view, {
    showPixelGrid: state.showPixelGrid,
    showCheckerboard: state.showCheckerboard,
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tool: DEFAULT_TOOL,
  shape: DEFAULT_SHAPE,
  brushSize: DEFAULT_BRUSH_SIZE,
  brushShape: DEFAULT_BRUSH_SHAPE,
  colour: null,
  // The overlays are on by default. The grid is the thing that tells a viewer
  // where one sprite pixel ends and the next begins, and it suppresses itself
  // whenever it would be a grey wash instead, so leaving it on costs nothing
  // when it is not wanted.
  ...storedView(),

  setTool: (tool) => {
    set({ tool });
  },

  setShape: (shape) => {
    // Picking a shape from the flyout selects the shape tool as well. Asking
    // for an ellipse and then being told to also press the shape button would
    // be an extra press to confirm something already said.
    set({ shape, tool: 'shape' });
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

  setColour: (colour) => {
    set({ colour });
  },

  setShowPixelGrid: (showPixelGrid) => {
    set({ showPixelGrid });
    remember(get());
  },

  setShowCheckerboard: (showCheckerboard) => {
    set({ showCheckerboard });
    remember(get());
  },
}));
