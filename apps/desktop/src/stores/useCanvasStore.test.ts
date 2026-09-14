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
 * A stroke, from the press to the release.
 *
 * This is the level the tools are actually used at: which tool, which brush,
 * which colour, and what the three of them together leave on the sprite. None
 * of it needs a browser, because the store holds pixels rather than a canvas.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createPixels, ERASE, pixelAt, writePixel, type Pixels, type Rgba } from '@/lib/pixels';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { DEFAULT_BRUSH_SHAPE, useEditorStore } from '@/stores/useEditorStore';

/** Opaque red, as channels. */
const RED: Rgba = [255, 0, 0, 255];

/** Opaque green, as channels. */
const GREEN: Rgba = [0, 128, 0, 255];

/** The same red, as the palette reports colours. */
const RED_HEX = '#'.concat('ff0000');

/**
 * Hands the store a sprite to draw on.
 *
 * @param prepare - Anything to put on the sprite before it is adopted.
 * @returns The buffer that was adopted.
 */
function adopt(prepare?: (pixels: Pixels) => void): Pixels {
  const pixels = createPixels(8, 8);
  prepare?.(pixels);
  // The encoded form is a label here, not bytes: nothing in this file decodes
  // or encodes anything, and the store only ever compares it.
  useCanvasStore.getState().adopt(0, 'sprite-under-test', pixels);
  return pixels;
}

/**
 * Reads a pixel of whatever the store currently holds.
 *
 * @param x - Column.
 * @param y - Row.
 * @returns The colour there.
 */
function at(x: number, y: number): Rgba {
  const { pixels } = useCanvasStore.getState();
  return pixels === null ? ERASE : pixelAt(pixels, { x, y });
}

/**
 * Draws a stroke from one pixel to another, as a drag would.
 *
 * @param points - Every pixel the pointer reported, in order.
 */
function drag(...points: { x: number; y: number }[]): void {
  const store = useCanvasStore.getState();
  const [first, ...rest] = points;
  if (first === undefined) {
    return;
  }
  store.begin(first);
  for (const point of rest) {
    useCanvasStore.getState().extend(point);
  }
  useCanvasStore.getState().finish();
}

beforeEach(() => {
  useCanvasStore.getState().release();
  useEditorStore.setState({
    tool: 'pencil',
    shape: 'rectangle',
    brushSize: 1,
    brushShape: DEFAULT_BRUSH_SHAPE,
    colour: RED_HEX,
  });
});

describe('the pencil', () => {
  it('paints the chosen colour along the drag', () => {
    adopt();
    drag({ x: 1, y: 1 }, { x: 4, y: 1 });

    expect(at(1, 1)).toEqual(RED);
    expect(at(2, 1)).toEqual(RED);
    expect(at(4, 1)).toEqual(RED);
    expect(at(4, 2)).toEqual(ERASE);
  });

  it('joins up pixels the pointer skipped over', () => {
    adopt();
    // A pointer reports a handful of positions a second; a quick drag arrives
    // as a scatter, and a stroke with holes in it is not a stroke.
    drag({ x: 0, y: 0 }, { x: 6, y: 0 });

    for (let x = 0; x <= 6; x += 1) {
      expect(at(x, 0)).toEqual(RED);
    }
  });

  it('paints in black when no colour has been chosen', () => {
    useEditorStore.setState({ colour: null });
    adopt();
    drag({ x: 2, y: 2 });

    expect(at(2, 2)).toEqual([0, 0, 0, 255]);
  });

  it('lays down the whole brush at sizes above one', () => {
    useEditorStore.setState({ brushSize: 3, brushShape: 'square' });
    adopt();
    drag({ x: 4, y: 4 });

    expect(at(3, 3)).toEqual(RED);
    expect(at(5, 5)).toEqual(RED);
  });

  it('ignores a press that starts outside the sprite', () => {
    adopt();
    drag({ x: 40, y: 40 });

    expect(useCanvasStore.getState().history.past).toHaveLength(0);
  });
});

describe('the eraser', () => {
  it('writes transparency rather than a colour', () => {
    adopt((pixels) => {
      writePixel(pixels, { x: 2, y: 2 }, GREEN, null);
    });
    useEditorStore.setState({ tool: 'eraser' });
    drag({ x: 2, y: 2 });

    expect(at(2, 2)).toEqual(ERASE);
  });
});

describe('the fill', () => {
  it('floods the region under the press', () => {
    adopt((pixels) => {
      for (let y = 0; y < 8; y += 1) {
        writePixel(pixels, { x: 4, y }, GREEN, null);
      }
    });
    useEditorStore.setState({ tool: 'fill' });
    drag({ x: 0, y: 0 });

    expect(at(3, 7)).toEqual(RED);
    expect(at(4, 4)).toEqual(GREEN);
    expect(at(5, 0)).toEqual(ERASE);
  });
});

describe('the shape tool', () => {
  it('lays down the outline the flyout chose, not the one it was dragged past', () => {
    adopt();
    useEditorStore.setState({ tool: 'shape', shape: 'rectangle' });
    // The pointer passes through the middle of the box on its way to the far
    // corner; only the final outline may survive.
    drag({ x: 1, y: 1 }, { x: 3, y: 3 }, { x: 5, y: 5 });

    expect(at(1, 1)).toEqual(RED);
    expect(at(5, 5)).toEqual(RED);
    expect(at(3, 1)).toEqual(RED);
    expect(at(3, 3)).toEqual(ERASE);
  });
});

describe('the selection', () => {
  it('clips everything drawn after it', () => {
    adopt();
    useEditorStore.setState({ tool: 'select' });
    drag({ x: 4, y: 0 }, { x: 7, y: 7 });

    expect(useCanvasStore.getState().selection).toEqual({ x: 4, y: 0, width: 4, height: 8 });

    useEditorStore.setState({ tool: 'pencil' });
    drag({ x: 0, y: 3 }, { x: 7, y: 3 });

    expect(at(3, 3)).toEqual(ERASE);
    expect(at(4, 3)).toEqual(RED);
  });

  it('bounds a fill as well as a stroke', () => {
    adopt();
    useEditorStore.setState({ tool: 'select' });
    drag({ x: 0, y: 0 }, { x: 2, y: 2 });

    useEditorStore.setState({ tool: 'fill' });
    drag({ x: 0, y: 0 });

    expect(at(2, 2)).toEqual(RED);
    expect(at(3, 3)).toEqual(ERASE);
  });

  it('is cleared by a press that goes nowhere', () => {
    adopt();
    useEditorStore.setState({ tool: 'select' });
    drag({ x: 1, y: 1 }, { x: 5, y: 5 });
    expect(useCanvasStore.getState().selection).not.toBeNull();

    drag({ x: 2, y: 2 });

    expect(useCanvasStore.getState().selection).toBeNull();
  });

  it('is not a stroke, so it is not something to undo', () => {
    adopt();
    useEditorStore.setState({ tool: 'select' });
    drag({ x: 1, y: 1 }, { x: 5, y: 5 });

    expect(useCanvasStore.getState().history.past).toHaveLength(0);
  });
});

describe('undo', () => {
  it('takes back a whole stroke, not a pixel of it', () => {
    adopt();
    drag({ x: 0, y: 0 }, { x: 7, y: 0 });
    useCanvasStore.getState().undo();

    for (let x = 0; x <= 7; x += 1) {
      expect(at(x, 0)).toEqual(ERASE);
    }
  });

  it('puts the stroke back', () => {
    adopt();
    drag({ x: 0, y: 0 }, { x: 7, y: 0 });
    useCanvasStore.getState().undo();
    useCanvasStore.getState().redo();

    expect(at(7, 0)).toEqual(RED);
  });

  it('walks back one stroke at a time', () => {
    adopt();
    drag({ x: 0, y: 0 });
    drag({ x: 1, y: 1 });

    useCanvasStore.getState().undo();
    expect(at(0, 0)).toEqual(RED);
    expect(at(1, 1)).toEqual(ERASE);

    useCanvasStore.getState().undo();
    expect(at(0, 0)).toEqual(ERASE);
  });

  it('records nothing for a stroke that changed nothing', () => {
    adopt((pixels) => {
      writePixel(pixels, { x: 2, y: 2 }, RED, null);
    });
    useEditorStore.setState({ tool: 'fill' });
    drag({ x: 2, y: 2 });

    expect(useCanvasStore.getState().history.past).toHaveLength(0);
  });

  it('does nothing when there is nothing to take back', () => {
    adopt();
    useCanvasStore.getState().undo();

    expect(useCanvasStore.getState().pixels).not.toBeNull();
  });
});

describe('adopting a sprite', () => {
  it('starts a fresh history, because the strokes were made on another sprite', () => {
    adopt();
    drag({ x: 1, y: 1 });
    expect(useCanvasStore.getState().history.past).toHaveLength(1);

    useCanvasStore.getState().adopt(0, 'a-different-sprite', createPixels(8, 8));

    expect(useCanvasStore.getState().history.past).toHaveLength(0);
    expect(useCanvasStore.getState().selection).toBeNull();
  });

  it('leaves the buffer alone when the sprite is the one it already holds', () => {
    adopt();
    drag({ x: 1, y: 1 });

    useCanvasStore.getState().adopt(0, 'sprite-under-test', createPixels(8, 8));

    expect(at(1, 1)).toEqual(RED);
  });
});
