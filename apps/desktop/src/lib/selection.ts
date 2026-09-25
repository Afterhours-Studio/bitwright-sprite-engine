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
 * Regions of a layer: the selection mask, and the few whole-region edits the
 * stage makes on the client because a selection has to shape them.
 *
 * A SELECTION IS A MASK, NOT A RECTANGLE. The magic wand selects a region of
 * any shape, so a selection is `width * height` bytes in row order and a
 * non-zero byte is a selected pixel - the shape `useEditorStore` already holds.
 * Rust never sees one: every tool clips its pixels here before the ops are
 * built, and a selection-shaped edit goes out as an ordinary `set_pixels`.
 *
 * THE FLOOD IS RUST'S FLOOD. `fill_region` floods four-connected pixels of the
 * seed's slot, and the wand and a fill clipped to a selection do the same, so
 * a region the wand picks is the region the bucket would have filled. Only the
 * traversal differs - a stack of pixels rather than Rust's scanline - and a
 * flood's result does not depend on the order it visits in.
 *
 * NO DOM, so all of it is unit-tested.
 */

import type { PixelSet, Point } from '@/types/document';
import type { Selection } from '@/stores/useEditorStore';

/** One layer's indices, as the document store holds them. */
export interface LayerPixels {
  width: number;
  height: number;
  data: readonly number[];
}

/** A rectangle, given as a corner and a size. */
export interface MaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reports whether a selection covers a pixel.
 *
 * @param selection - The selection.
 * @param x - Column.
 * @param y - Row.
 * @returns True when the pixel is on the document and selected.
 */
export function selects(selection: Selection, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= selection.width || y >= selection.height) {
    return false;
  }
  return (selection.mask[y * selection.width + x] ?? 0) !== 0;
}

/**
 * The selection a rectangle-select drag makes.
 *
 * Both corners are included, because the drag started on one pixel and ended
 * on another and a person means both of them. The box is clipped to the
 * document, since a mask only has the document's pixels to hold.
 *
 * @param from - Where the drag began.
 * @param to - Where it ended.
 * @param canvas - The document's size.
 * @returns The selection.
 */
export function rectSelection(
  from: Point,
  to: Point,
  canvas: { width: number; height: number },
): Selection {
  const mask = new Uint8Array(canvas.width * canvas.height);
  const left = Math.max(0, Math.min(from.x, to.x));
  const right = Math.min(canvas.width - 1, Math.max(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const bottom = Math.min(canvas.height - 1, Math.max(from.y, to.y));
  for (let y = top; y <= bottom; y += 1) {
    mask.fill(1, y * canvas.width + left, y * canvas.width + right + 1);
  }
  return { width: canvas.width, height: canvas.height, mask };
}

/**
 * The four-connected region of the seed's slot, optionally held inside a
 * selection.
 *
 * @param layer - The layer to read.
 * @param seed - Where the press landed.
 * @param within - A selection the region may not leave, or null for none. A
 *   seed outside it makes no region at all.
 * @returns A mask of the region, or null when the seed is off the document or
 *   outside `within`.
 */
export function floodRegion(
  layer: LayerPixels,
  seed: Point,
  within: Selection | null = null,
): Uint8Array | null {
  const { width, height, data } = layer;
  const allowed = (x: number, y: number): boolean => within === null || selects(within, x, y);
  if (seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) {
    return null;
  }
  if (!allowed(seed.x, seed.y)) {
    return null;
  }
  const target = data[seed.y * width + seed.x];
  const region = new Uint8Array(width * height);
  const stack: number[] = [seed.y * width + seed.x];
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (region[index] !== 0 || data[index] !== target) {
      continue;
    }
    const x = index % width;
    const y = (index - x) / width;
    if (!allowed(x, y)) {
      continue;
    }
    region[index] = 1;
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - width);
    if (y < height - 1) stack.push(index + width);
  }
  return region;
}

/**
 * The selection a magic-wand click makes.
 *
 * @param layer - The active layer.
 * @param seed - The pixel clicked.
 * @param contiguous - True for the connected region of the clicked slot, false
 *   (the Shift click) for every pixel of that slot on the layer.
 * @returns The selection, or null when the click was off the document.
 */
export function wandSelection(
  layer: LayerPixels,
  seed: Point,
  contiguous: boolean,
): Selection | null {
  const { width, height, data } = layer;
  if (seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) {
    return null;
  }
  if (contiguous) {
    const region = floodRegion(layer, seed);
    return region === null ? null : { width, height, mask: region };
  }
  const target = data[seed.y * width + seed.x];
  const mask = new Uint8Array(width * height);
  data.forEach((slot, index) => {
    if (slot === target) {
      mask[index] = 1;
    }
  });
  return { width, height, mask };
}

/**
 * Keeps the pixels a selection covers.
 *
 * @param pixels - Anything with a position.
 * @param selection - The selection, or null to keep everything.
 * @returns The pixels inside it, in their original order.
 */
export function clipToSelection<T extends Point>(
  pixels: readonly T[],
  selection: Selection | null,
): T[] {
  if (selection === null) {
    return [...pixels];
  }
  return pixels.filter((pixel) => selects(selection, pixel.x, pixel.y));
}

/**
 * The smallest rectangle holding every selected pixel.
 *
 * @param selection - The selection.
 * @returns The bounds, or null when nothing is selected.
 */
export function selectionBounds(selection: Selection): MaskBounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      if ((selection.mask[y * selection.width + x] ?? 0) !== 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) {
    return null;
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The selection's edge, as an SVG path in document pixels.
 *
 * An edge is drawn wherever a selected pixel meets an unselected one or the
 * document's border, which is what makes a wand selection with a hole in it
 * show the hole. Neighbouring edges on one line are merged into a single run,
 * so a 64 pixel wide box is four segments rather than two hundred and fifty.
 *
 * @param selection - The selection.
 * @param offset - A shift to draw it at, for a selection being moved.
 * @returns The path's `d` attribute, empty when nothing is selected.
 */
export function selectionOutline(selection: Selection, offset: Point = { x: 0, y: 0 }): string {
  const { width, height } = selection;
  const on = (x: number, y: number): boolean => selects(selection, x, y);
  const parts: string[] = [];

  // Horizontal edges lie on row lines 0..height, between row y-1 and row y.
  for (let y = 0; y <= height; y += 1) {
    let start: number | null = null;
    for (let x = 0; x <= width; x += 1) {
      const edge = x < width && on(x, y - 1) !== on(x, y);
      if (edge && start === null) {
        start = x;
      } else if (!edge && start !== null) {
        parts.push(`M${String(start + offset.x)} ${String(y + offset.y)}H${String(x + offset.x)}`);
        start = null;
      }
    }
  }
  // Vertical edges lie on column lines 0..width, between column x-1 and x.
  for (let x = 0; x <= width; x += 1) {
    let start: number | null = null;
    for (let y = 0; y <= height; y += 1) {
      const edge = y < height && on(x - 1, y) !== on(x, y);
      if (edge && start === null) {
        start = y;
      } else if (!edge && start !== null) {
        parts.push(`M${String(x + offset.x)} ${String(start + offset.y)}V${String(y + offset.y)}`);
        start = null;
      }
    }
  }
  return parts.join('');
}

/**
 * Shifts a selection, dropping whatever leaves the document.
 *
 * @param selection - The selection.
 * @param dx - Columns to move right.
 * @param dy - Rows to move down.
 * @returns The moved selection.
 */
export function translateSelection(selection: Selection, dx: number, dy: number): Selection {
  const { width, height } = selection;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (selects(selection, x - dx, y - dy)) {
        mask[y * width + x] = 1;
      }
    }
  }
  return { width, height, mask };
}

/**
 * The writes that make a layer equal to `next`, as a pixel list.
 *
 * @param layer - The layer as it is.
 * @param next - What it should become, same size.
 * @returns One entry per pixel that changes.
 */
function difference(layer: LayerPixels, next: readonly number[]): PixelSet[] {
  const pixels: PixelSet[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const slot = next[index] as number;
    if (slot !== layer.data[index]) {
      pixels.push({ x: index % layer.width, y: Math.floor(index / layer.width), slot });
    }
  }
  return pixels;
}

/**
 * Lifts the selected pixels and puts them down at an offset.
 *
 * Only painted pixels travel: a transparent pixel inside the selection is the
 * absence of something, and carrying it would punch holes in whatever the
 * selection is dropped over. The places the pixels left become transparent
 * unless something moved onto them, and a pixel moved off the document is
 * gone, which is what a move past the edge means in every editor.
 *
 * @param layer - The active layer.
 * @param selection - What to lift.
 * @param dx - Columns to move right.
 * @param dy - Rows to move down.
 * @returns The writes, as one `set_pixels` list, and nothing when the move
 *   changes nothing.
 */
export function moveSelected(
  layer: LayerPixels,
  selection: Selection,
  dx: number,
  dy: number,
): PixelSet[] {
  const { width, height, data } = layer;
  const next = [...data];
  const lifted: { x: number; y: number; slot: number }[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const slot = data[index] ?? 0;
      if (selects(selection, x, y) && slot !== 0) {
        lifted.push({ x: x + dx, y: y + dy, slot });
        next[index] = 0;
      }
    }
  }
  for (const pixel of lifted) {
    if (pixel.x >= 0 && pixel.y >= 0 && pixel.x < width && pixel.y < height) {
      next[pixel.y * width + pixel.x] = pixel.slot;
    }
  }
  return difference(layer, next);
}

/**
 * What `translate` would do to a layer, as the pixels it changes.
 *
 * Rust's rule exactly: every pixel takes the value of the one `dx, dy` behind
 * it, and what comes in from past the edge is transparent. Used for the
 * preview of a move with no selection; the move itself is sent as the op.
 *
 * @param layer - The active layer.
 * @param dx - Columns to move right.
 * @param dy - Rows to move down.
 * @returns The pixels that change.
 */
export function translatedLayer(layer: LayerPixels, dx: number, dy: number): PixelSet[] {
  const { width, height, data } = layer;
  const next: number[] = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
        next[y * width + x] = data[sy * width + sx] ?? 0;
      }
    }
  }
  return difference(layer, next);
}

/**
 * The writes that make every selected, painted pixel transparent.
 *
 * @param layer - The active layer.
 * @param selection - What to clear.
 * @returns The writes; empty when the selection holds nothing painted.
 */
export function clearSelected(layer: LayerPixels, selection: Selection): PixelSet[] {
  const pixels: PixelSet[] = [];
  layer.data.forEach((slot, index) => {
    const x = index % layer.width;
    const y = Math.floor(index / layer.width);
    if (slot !== 0 && selects(selection, x, y)) {
      pixels.push({ x, y, slot: 0 });
    }
  });
  return pixels;
}

/**
 * The writes that repaint every pixel of one slot with another.
 *
 * @param layer - The active layer.
 * @param from - The slot to replace.
 * @param to - The slot to paint instead.
 * @returns The writes; empty when the slots are the same or `from` is unused.
 */
export function replaceSlot(layer: LayerPixels, from: number, to: number): PixelSet[] {
  if (from === to) {
    return [];
  }
  const pixels: PixelSet[] = [];
  layer.data.forEach((slot, index) => {
    if (slot === from) {
      pixels.push({ x: index % layer.width, y: Math.floor(index / layer.width), slot: to });
    }
  });
  return pixels;
}
