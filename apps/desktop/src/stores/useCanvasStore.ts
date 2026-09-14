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
 * The sprite being drawn on.
 *
 * THE BUFFER IS THE TRUTH. The engine's PNG is decoded once, when a sprite
 * arrives, and is not read again; from then on the pixels here are the sprite
 * and the encoded form is something produced from them. The alternative -
 * keeping the PNG authoritative and treating the buffer as a cache - means
 * every stroke has to decide which of the two is right, and they disagree the
 * first time an encode fails.
 *
 * `useEditorStore` says what the next stroke would do; this is where one is
 * made. The two are deliberately apart: the dock can be pressed with no sprite
 * on screen, and the editor's settings outlive any particular sprite.
 *
 * A STROKE IS THE UNIT. Everything a drag does is drawn from the buffer the
 * drag started on, every time the pointer moves, rather than accumulated on
 * top of what the last move left. That is what lets a shape follow the cursor
 * without smearing every intermediate rectangle onto the sprite, and it is
 * what makes pixel-perfect correction possible at all - a corner that turns
 * out to be redundant simply is not drawn on the next pass, with nothing to
 * un-draw.
 *
 * Nothing here touches the DOM. The pixel work is in `lib/pixels.ts` and the
 * encoding in `lib/png.ts`, so what a tool does can be tested without a
 * browser.
 */

import { create } from 'zustand';

import {
  EMPTY_HISTORY,
  record,
  redo as stepForward,
  undo as stepBack,
  type History,
} from '@/lib/history';
import { encodePng } from '@/lib/png';
import {
  brushOffsets,
  clonePixels,
  ERASE,
  FILL_TOLERANCE,
  floodFill,
  linePoints,
  parseColour,
  pixelPerfect,
  rectFrom,
  shapePoints,
  stamp,
  withinSprite,
  type Pixels,
  type Point,
  type Rect,
  type Rgba,
} from '@/lib/pixels';
import { useEditorStore, type Shape, type Tool } from '@/stores/useEditorStore';
import { useGenerationStore } from '@/stores/useGenerationStore';

/**
 * What painting writes when no palette colour has been chosen.
 *
 * Opaque black, which is what Aseprite, Libresprite and Pixelorama all start a
 * session on. The alternative - refusing to paint until a swatch is pressed -
 * makes the pencil a control that does nothing, and the palette does not exist
 * until a sprite has been through Adjust, so there would be a whole stage of
 * the work with no usable pencil in it.
 *
 * Written as channels rather than as hex because a literal colour in a source
 * file is banned project wide, and rightly so: the checks that enforce it
 * cannot tell an interface colour from a sprite's own pixel. This one is a
 * sprite's pixel.
 */
const DEFAULT_INK: Rgba = [0, 0, 0, 255];

/** A drag in progress. */
interface Stroke {
  /** The tool, taken when the drag began, so a mid-drag change cannot alter it. */
  readonly tool: Tool;
  /** The outline, for the shape tool, taken at the same moment and for the same reason. */
  readonly shape: Shape;
  /** What the stroke writes. */
  readonly colour: Rgba;
  /** The brush footprint. */
  readonly offsets: readonly Point[];
  /** Whether redundant corners are dropped, which only a one pixel brush wants. */
  readonly perfect: boolean;
  /** The buffer as the drag began, which every redraw starts from. */
  readonly before: Pixels;
  /** Where the drag started. */
  readonly from: Point;
  /** Where the pointer has been, for a freehand stroke. */
  readonly points: Point[];
  /** Where the pointer is now. */
  readonly to: Point;
}

interface CanvasState {
  /** Which sprite of the batch the buffer belongs to, or null before one does. */
  index: number | null;
  /**
   * The encoded sprite the buffer last agreed with.
   *
   * Both what was decoded on arrival and what was last published, so the
   * surface can tell a sprite that changed underneath it from its own output
   * coming back around through the generation store.
   */
  origin: string | null;
  /** The sprite, as pixels. Null until one is adopted. */
  pixels: Pixels | null;
  /** Strokes that can be taken back, and strokes that were. */
  history: History;
  /** The region tools are clipped to, or null for the whole sprite. */
  selection: Rect | null;
  /** The drag in progress, or null. */
  stroke: Stroke | null;

  /** Takes a decoded sprite as the thing being drawn on. */
  adopt: (index: number, data: string, pixels: Pixels) => void;
  /** Drops the buffer, for when there is no longer a sprite to draw on. */
  release: () => void;
  /** Starts a stroke at a pixel. */
  begin: (point: Point) => void;
  /** Continues the stroke to a pixel. */
  extend: (point: Point) => void;
  /** Ends the stroke, recording it if it changed anything. */
  finish: () => void;
  /** Takes back one stroke. */
  undo: () => void;
  /** Puts back one stroke that was taken back. */
  redo: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  index: null,
  origin: null,
  pixels: null,
  history: EMPTY_HISTORY,
  selection: null,
  stroke: null,

  adopt: (index, data, pixels) => {
    const state = get();
    if (state.index === index && state.origin === data) {
      return;
    }
    // A different sprite is a different history. Offering to undo a stroke
    // onto a sprite it was never made on is worse than offering nothing.
    set({
      index,
      origin: data,
      pixels,
      history: EMPTY_HISTORY,
      selection: null,
      stroke: null,
    });
  },

  release: () => {
    set({
      index: null,
      origin: null,
      pixels: null,
      history: EMPTY_HISTORY,
      selection: null,
      stroke: null,
    });
  },

  begin: (point) => {
    const { pixels, selection } = get();
    if (pixels === null || !withinSprite(point, pixels)) {
      return;
    }

    const editor = useEditorStore.getState();
    const stroke: Stroke = {
      tool: editor.tool,
      shape: editor.shape,
      colour: ink(editor.tool, editor.colour),
      offsets: brushOffsets(editor.brushSize, editor.brushShape),
      // Only a one pixel brush has corners worth correcting; a wide brush
      // already covers the pixel the rule would remove.
      perfect: editor.brushSize === 1,
      before: clonePixels(pixels),
      from: point,
      points: [point],
      to: point,
    };

    if (stroke.tool === 'select') {
      // The marquee follows the drag from the first press, so the region is
      // visible while it is being chosen rather than only once it is made.
      set({ stroke, selection: rectFrom(point, point) });
      return;
    }

    if (stroke.tool === 'fill') {
      // A press, not a drag: the bucket acts once, where it was pressed.
      const next = clonePixels(stroke.before);
      floodFill(next, point, stroke.colour, FILL_TOLERANCE, selection);
      set({ stroke, pixels: next });
      return;
    }

    set({ stroke, pixels: paint(stroke, selection) });
  },

  extend: (point) => {
    const { stroke, selection } = get();
    if (stroke === null) {
      return;
    }

    const last = stroke.points.at(-1);
    if (last !== undefined && last.x === point.x && last.y === point.y) {
      return;
    }

    const next: Stroke = { ...stroke, points: [...stroke.points, point], to: point };

    if (next.tool === 'select') {
      set({ stroke: next, selection: rectFrom(next.from, point) });
      return;
    }

    if (next.tool === 'fill') {
      // Dragging a bucket does nothing anywhere else either.
      set({ stroke: next });
      return;
    }

    set({ stroke: next, pixels: paint(next, selection) });
  },

  finish: () => {
    const { stroke, pixels, history } = get();
    if (stroke === null) {
      return;
    }

    if (stroke.tool === 'select') {
      // A press that went nowhere clears the selection. Otherwise the only way
      // back to drawing on the whole sprite would be a second control, and a
      // one pixel selection is not a region anybody meant to make.
      const dragged = stroke.to.x !== stroke.from.x || stroke.to.y !== stroke.from.y;
      set({ stroke: null, selection: dragged ? rectFrom(stroke.from, stroke.to) : null });
      return;
    }

    set({ stroke: null });
    if (pixels === null || !differs(stroke.before, pixels)) {
      // A stroke that changed nothing - a fill onto its own colour, a press
      // outside the selection - is not a step anyone wants to walk back
      // through.
      return;
    }

    set({ history: record(history, stroke.before) });
    publish();
  },

  undo: () => {
    const { history, pixels } = get();
    if (pixels === null) {
      return;
    }
    const stepped = stepBack(history, pixels);
    if (stepped === null) {
      return;
    }
    set({ history: stepped.history, pixels: stepped.pixels, stroke: null });
    publish();
  },

  redo: () => {
    const { history, pixels } = get();
    if (pixels === null) {
      return;
    }
    const stepped = stepForward(history, pixels);
    if (stepped === null) {
      return;
    }
    set({ history: stepped.history, pixels: stepped.pixels, stroke: null });
    publish();
  },
}));

/**
 * Decides what a stroke writes.
 *
 * @param tool - The tool the stroke was begun with.
 * @param colour - The chosen palette colour, or null when none has been.
 * @returns The colour to write.
 */
function ink(tool: Tool, colour: string | null): Rgba {
  if (tool === 'eraser') {
    return ERASE;
  }
  return (colour === null ? null : parseColour(colour)) ?? DEFAULT_INK;
}

/**
 * Draws a stroke onto the buffer it began from.
 *
 * @param stroke - The stroke so far.
 * @param selection - The region the stroke is clipped to, or null.
 * @returns A new buffer with the stroke on it.
 */
function paint(stroke: Stroke, selection: Rect | null): Pixels {
  const next = clonePixels(stroke.before);

  if (stroke.tool === 'shape') {
    for (const point of shapePoints(stroke.shape, stroke.from, stroke.to)) {
      stamp(next, point, stroke.colour, stroke.offsets, selection);
    }
    return next;
  }

  for (const point of connect(stroke.points, stroke.perfect)) {
    stamp(next, point, stroke.colour, stroke.offsets, selection);
  }
  return next;
}

/**
 * Joins the pixels a pointer visited into a continuous stroke.
 *
 * A pointer reports a handful of positions a second, so a quick drag arrives
 * as a scatter of pixels several apart; without the joining lines a stroke is
 * a dotted line. The corner correction runs on the joined path rather than on
 * the reported positions, because the corners it removes are made by the
 * joining, not by the pointer.
 *
 * @param points - The positions the pointer reported, in order.
 * @param perfect - Whether redundant corner pixels are dropped.
 * @returns The pixels to stamp, in order, with no pixel repeated back to back.
 */
function connect(points: readonly Point[], perfect: boolean): Point[] {
  const path: Point[] = [];
  let previous = points[0];
  for (const point of points) {
    if (previous === undefined) {
      break;
    }
    for (const step of linePoints(previous, point)) {
      const last = path.at(-1);
      if (last === undefined || last.x !== step.x || last.y !== step.y) {
        path.push(step);
      }
    }
    previous = point;
  }
  return perfect ? pixelPerfect(path) : path;
}

/**
 * Reports whether a stroke changed anything.
 *
 * @param before - The buffer as the stroke began.
 * @param after - The buffer as it ended.
 * @returns True when at least one channel differs.
 */
function differs(before: Pixels, after: Pixels): boolean {
  if (before.data.length !== after.data.length) {
    return true;
  }
  for (let offset = 0; offset < before.data.length; offset += 1) {
    if (before.data[offset] !== after.data[offset]) {
      return true;
    }
  }
  return false;
}

/**
 * Hands the painted sprite to the rest of the application.
 *
 * This is what makes a stroke real outside the stage: the generation store
 * holds the sprite the gallery lists, the Adjust step corrects and the shell
 * writes to disk, so a painted sprite that did not go back into it would be a
 * picture of an edit rather than an edit.
 *
 * Publishing on every committed stroke, and on every undo, rather than behind
 * a save control: the store the sprite comes from is already the one every
 * other screen reads, and a separate save would mean the stage and the gallery
 * showed different sprites until it was pressed.
 *
 * A platform that cannot encode keeps its buffer and publishes nothing, which
 * is the case under test and would be the case in a webview with no canvas.
 */
function publish(): void {
  const { pixels, index } = useCanvasStore.getState();
  if (pixels === null || index === null) {
    return;
  }

  const data = encodePng(pixels);
  if (data === null) {
    return;
  }

  // Recorded before it is handed over, so that the sprite coming back through
  // the generation store is recognised as this buffer's own output and does
  // not cause it to be decoded and adopted again.
  useCanvasStore.setState({ origin: data });
  useGenerationStore.getState().paint(index, data);
}

/**
 * Reports whether there is a stroke to take back.
 *
 * A selector rather than a field, so that nothing has to be kept in step with
 * the history it describes.
 *
 * @param state - The store state.
 * @returns True when undo would do something.
 */
export function canUndo(state: CanvasState): boolean {
  return state.pixels !== null && state.history.past.length > 0;
}

/**
 * Reports whether there is a stroke to put back.
 *
 * @param state - The store state.
 * @returns True when redo would do something.
 */
export function canRedo(state: CanvasState): boolean {
  return state.pixels !== null && state.history.future.length > 0;
}
