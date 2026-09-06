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
 * tool is chosen today, and the editing surface that will consume it is a
 * separate piece of work, which is why the store is named for the editor and
 * carries no knowledge of the bar that sets it.
 *
 * Nothing here modifies an image. Choosing a tool says what the next stroke
 * would do; it does not make one. That is what allows the picker to sit in an
 * always-visible bar at all, where a control that acted on press would be the
 * easiest thing on screen to hit by accident.
 *
 * The tool set is the one every pixel editor agrees on. Aseprite, Libresprite,
 * Piskel and Pixelorama all put a pencil, an eraser, a bucket fill, a
 * rectangular selection and the shape tools on their primary bar, so those are
 * the tools here.
 *
 * There is no colour picker. The main canvas area is being split into two
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
 */

import { create } from 'zustand';

/** A drawing tool. */
export type Tool = 'pencil' | 'eraser' | 'fill' | 'select' | 'shape';

/** The outline the shape tool lays down. */
export type Shape = 'line' | 'curve' | 'rectangle' | 'ellipse';

/** The tools, in the order a toolbar lists them. */
export const TOOLS: readonly Tool[] = ['pencil', 'eraser', 'fill', 'select', 'shape'];

/**
 * The shapes, in the order the flyout lists them.
 *
 * Read as a two by two grid rather than a list: the open paths on the first
 * row, the closed outlines on the second.
 */
export const SHAPES: readonly Shape[] = ['line', 'curve', 'rectangle', 'ellipse'];

/** The tool a session starts on. */
export const DEFAULT_TOOL: Tool = 'pencil';

/** The shape a session starts on. */
export const DEFAULT_SHAPE: Shape = 'rectangle';

interface EditorState {
  /** The tool the next stroke would use. */
  tool: Tool;
  /** The outline the shape tool would lay down. */
  shape: Shape;

  /** Chooses the tool. */
  setTool: (tool: Tool) => void;
  /** Chooses the shape, and with it the shape tool. */
  setShape: (shape: Shape) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: DEFAULT_TOOL,
  shape: DEFAULT_SHAPE,

  setTool: (tool) => {
    set({ tool });
  },

  setShape: (shape) => {
    // Picking a shape from the flyout selects the shape tool as well. Asking
    // for an ellipse and then being told to also press the shape button would
    // be an extra press to confirm something already said.
    set({ shape, tool: 'shape' });
  },
}));
