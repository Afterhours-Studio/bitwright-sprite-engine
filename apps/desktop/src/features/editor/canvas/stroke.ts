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
 * One drag of the pointer, turned into the ops that commit it.
 *
 * ONE STROKE IS ONE BATCH, WHICH IS ONE UNDO.
 *
 * Everything a drag did becomes a single array handed to `document_write_ops`,
 * because that command's batch is the undo entry. A pencil stroke sent as
 * three hundred single-pixel writes would take three hundred presses of undo
 * to take back, which is not what anybody means by "undo that stroke".
 *
 * NOTHING HERE PAINTS.
 *
 * These functions return ops, and the pixels a preview draws. The pixels are
 * written by Rust, composited by Rust, and arrive back through
 * `document://changed`. The preview and the op read the same functions, so a
 * preview cannot show something different from what lands.
 *
 * WHICH TOOLS RESOLVE PIXELS HERE. The freehand ones - pencil, eraser, dither,
 * lighten, darken - always, because no op has an argument for the path a hand
 * took. The bucket and the shapes only while a selection exists, because
 * `fill_region` and `draw_shape` cannot be clipped; without one they stay ops,
 * so Rust's rasteriser remains the one an agent and a person share. The move
 * tool resolves pixels only for a selection, and otherwise sends `translate`.
 *
 * WHY THE SLOT AND NOT A COLOUR.
 *
 * A pixel is a palette index. The pencil writes the active slot; the eraser
 * writes {@link TRANSPARENT}, which is index 0 and is not a slot at all. That
 * is why there is no colour anywhere in this file: what slot 7 looks like is a
 * property of the palette, and a stroke that carried a colour could put a
 * colour on the sprite that the palette does not contain.
 */

import {
  brushOffsets,
  ditherSlot,
  linePoints,
  mirrorPoints,
  pixelPerfect,
  rampStep,
  type SymmetryAxes,
} from '@/lib/pixels';
import {
  floodRegion,
  moveSelected,
  selects,
  translatedLayer,
  type LayerPixels,
} from '@/lib/selection';
import { shapePoints } from '@/lib/shapes';
import {
  shapeOf,
  type BrushShape,
  type Selection,
  type Shape,
  type Tool,
} from '@/stores/useEditorStore';
import type { LayerRole, Op, PixelSet, Point, Ramp, Shape as OpShape } from '@/types/document';

/**
 * The index that means "nothing here".
 *
 * Zero is reserved and is not a palette slot, which is what lets the eraser be
 * an ordinary write rather than a second kind of operation.
 */
export const TRANSPARENT = 0;

/** A document's size, in document pixels. */
export interface StrokeCanvas {
  width: number;
  height: number;
}

/** Everything a finished drag knows about itself. */
export interface Stroke {
  /**
   * The tool, as it was when the drag began. A shape tool carries its figure
   * in its name, which `shapeOf` reads back.
   */
  tool: Tool;
  /** The layer the stroke writes to. */
  layer: LayerRole;
  /**
   * The palette slot the stroke writes, 1 to 62. Ignored by the eraser. A
   * right-button drag arrives here with the two slots already traded.
   */
  slot: number;
  /** The slot the dither writes on its odd cells. Defaults to `slot`. */
  secondarySlot?: number;
  /** How many document pixels across the brush is. */
  brushSize: number;
  /** The brush's footprint above one pixel. */
  brushShape: BrushShape;
  /** Every document pixel the pointer reported, in order, first press first. */
  points: readonly Point[];
  /** The document's size, which is what a stroke is clipped to. */
  canvas: StrokeCanvas;
  /** The mirrors a freehand stroke also writes. Defaults to none. */
  symmetry?: SymmetryAxes;
  /**
   * The selection every pixel is clipped to, or null (the default) for none.
   * A selection of another size than the canvas is the caller's to drop.
   */
  selection?: Selection | null;
  /**
   * The target layer's indices as the stroke began. Lighten, darken, a
   * clipped fill and a move of a selection read it; without it they write
   * nothing rather than guess.
   */
  buffer?: LayerPixels | null;
  /** The palette's ramps, which lighten and darken step along. */
  ramps?: readonly Ramp[];
  /** Whether a rectangle or an ellipse is filled. Defaults to an outline. */
  shapeFill?: boolean;
}

/**
 * The editor's names for the shape tool's figures, in the op's names for them.
 *
 * The two lists differ in exactly one word: the interface says `rectangle`
 * because that is what a person calls it, and the op says `rect` because that
 * is what Rust's `Shape` enum serialises. Mapping it in one place is what keeps
 * the mismatch from being re-derived at each call site and got wrong at one.
 */
const OP_SHAPES: Readonly<Record<Shape, OpShape>> = {
  line: 'line',
  curve: 'curve',
  rectangle: 'rect',
  ellipse: 'ellipse',
};

/** The tools that write the pixels a drag passed over. */
const FREEHAND: readonly Tool[] = ['pencil', 'eraser', 'dither', 'lighten', 'darken'];

/**
 * Reports whether a tool writes the pixels its drag passed over.
 *
 * @param tool - A tool.
 * @returns True for the pencil, the eraser, the dither, lighten and darken.
 */
export function isFreehand(tool: Tool): boolean {
  return FREEHAND.includes(tool);
}

/**
 * The document pixels a freehand stroke covers, and the slot each one gets.
 *
 * The pointer reports a handful of positions per second and a hand moves
 * faster than that, so consecutive reports are joined with a line rather than
 * stamped where they landed; without it a quick stroke is a row of dots.
 *
 * Pixel-perfect correction is applied only at a one pixel brush, because it
 * removes the middle pixel of a diagonal corner and a wider brush covers that
 * pixel anyway - running it there would thin the stroke rather than clean it.
 *
 * Each stamped pixel is then mirrored, clipped to the document and to the
 * selection, and given its slot: the dither by the pixel's own parity, and
 * lighten and darken by one step along the ramp the pixel is already painted
 * with, leaving out any pixel that has no step to take.
 *
 * Duplicates are dropped and the first occurrence wins, so the op is as short
 * as the marks it makes. A stroke that doubles back over itself writes each
 * pixel once, which matters for lighten and darken above all: a pixel crossed
 * twice in one stroke still moves one step, not two.
 *
 * @param stroke - The finished drag.
 * @returns Every pixel the stroke writes, in the order it first reached them.
 */
export function strokePixels(stroke: Stroke): PixelSet[] {
  const path = stroke.points;
  if (path.length === 0) {
    return [];
  }

  const joined: Point[] = [path[0] as Point];
  for (let index = 1; index < path.length; index += 1) {
    // The first pixel of each segment is the last of the previous one, so it
    // is dropped rather than stamped a second time.
    joined.push(...linePoints(path[index - 1] as Point, path[index] as Point).slice(1));
  }

  const corrected = stroke.brushSize === 1 ? pixelPerfect(joined) : joined;
  const offsets = brushOffsets(stroke.brushSize, stroke.brushShape);
  const symmetry = stroke.symmetry ?? 'off';
  const selection = stroke.selection ?? null;
  const { width, height } = stroke.canvas;

  const seen = new Set<number>();
  const pixels: PixelSet[] = [];
  for (const point of corrected) {
    for (const offset of offsets) {
      const stamped = { x: point.x + offset.x, y: point.y + offset.y };
      for (const { x, y } of mirrorPoints(stamped, symmetry, stroke.canvas)) {
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        if (selection !== null && !selects(selection, x, y)) {
          continue;
        }
        const key = y * width + x;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const slot = slotAt(stroke, { x, y });
        if (slot !== null) {
          pixels.push({ x, y, slot });
        }
      }
    }
  }
  return pixels;
}

/**
 * The slot a freehand tool writes at one pixel.
 *
 * @param stroke - The stroke.
 * @param point - The pixel, on the document.
 * @returns The slot, or null to leave the pixel as it is.
 */
function slotAt(stroke: Stroke, point: Point): number | null {
  switch (stroke.tool) {
    case 'eraser':
      return TRANSPARENT;
    case 'dither':
      return ditherSlot(point, stroke.slot, stroke.secondarySlot ?? stroke.slot);
    case 'lighten':
    case 'darken': {
      const buffer = stroke.buffer;
      if (buffer === null || buffer === undefined) {
        return null;
      }
      const current = buffer.data[point.y * buffer.width + point.x] ?? TRANSPARENT;
      return rampStep(current, stroke.ramps ?? [], stroke.tool === 'lighten' ? 1 : -1);
    }
    default:
      return stroke.slot;
  }
}

/**
 * The pixels a clipped bucket fill covers.
 *
 * @param stroke - A fill stroke.
 * @param selection - The region the fill may not leave, or null.
 * @returns The region, every pixel of it given the stroke's slot.
 */
function fillPixels(stroke: Stroke, selection: Selection | null): PixelSet[] {
  const seed = stroke.points[0];
  const buffer = stroke.buffer;
  if (seed === undefined || buffer === null || buffer === undefined) {
    return [];
  }
  const region = floodRegion(buffer, seed, selection);
  if (region === null) {
    return [];
  }
  const pixels: PixelSet[] = [];
  region.forEach((inside, index) => {
    if (inside !== 0) {
      pixels.push({
        x: index % buffer.width,
        y: Math.floor(index / buffer.width),
        slot: stroke.slot,
      });
    }
  });
  return pixels;
}

/**
 * The pixels a shape covers, clipped to the selection when there is one.
 *
 * @param stroke - A shape stroke.
 * @param shape - Its figure.
 * @returns The pixels, in the shape's slot.
 */
function shapePixels(stroke: Stroke, shape: Shape): PixelSet[] {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }
  const selection = stroke.selection ?? null;
  return shapePoints(OP_SHAPES[shape], first, last, stroke.shapeFill ?? false, stroke.canvas)
    .filter((point) => selection === null || selects(selection, point.x, point.y))
    .map((point) => ({ x: point.x, y: point.y, slot: stroke.slot }));
}

/**
 * How far a move drag has carried, first press to last position.
 *
 * @param stroke - A move stroke.
 * @returns The offset, in document pixels.
 */
function moveOffset(stroke: Stroke): Point {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  if (first === undefined || last === undefined) {
    return { x: 0, y: 0 };
  }
  return { x: last.x - first.x, y: last.y - first.y };
}

/**
 * What to draw over the document while the button is still down.
 *
 * The same pixels the commit resolves wherever the commit resolves any, and
 * for the two tools that stay ops - an unclipped fill and an unclipped shape -
 * the pixels Rust will produce, computed by the ports in `lib/selection.ts`
 * and `lib/shapes.ts`. A move previews every pixel it would change, the
 * places it vacates included, which is what makes the lift visible.
 *
 * @param stroke - The drag so far.
 * @returns The pixels to preview, each with the slot it would get.
 */
export function strokePreview(stroke: Stroke): PixelSet[] {
  if (isFreehand(stroke.tool)) {
    return strokePixels(stroke);
  }
  if (stroke.tool === 'fill') {
    return fillPixels(stroke, stroke.selection ?? null);
  }
  const shape = shapeOf(stroke.tool);
  if (shape !== null) {
    return shapePixels(stroke, shape);
  }
  if (stroke.tool === 'move') {
    const buffer = stroke.buffer;
    if (buffer === null || buffer === undefined) {
      return [];
    }
    const { x, y } = moveOffset(stroke);
    if (x === 0 && y === 0) {
      return [];
    }
    const selection = stroke.selection ?? null;
    return selection === null
      ? translatedLayer(buffer, x, y)
      : moveSelected(buffer, selection, x, y);
  }
  return [];
}

/**
 * The ops that commit a finished drag.
 *
 * An empty array means the drag did nothing - a press that never landed on the
 * document, or a fill outside it - and a caller passing an empty batch to
 * `document_write_ops` would get `document.invalid_batch` back for a stroke
 * that was never made.
 *
 * @param stroke - The finished drag.
 * @returns The batch to commit, which is one undo entry.
 */
export function strokeOps(stroke: Stroke): Op[] {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }
  const selection = stroke.selection ?? null;

  if (stroke.tool === 'fill') {
    if (!within(first, stroke.canvas)) {
      return [];
    }
    if (selection !== null) {
      // Only the pixels that change, so a fill of a region already in the
      // slot is no batch at all rather than an undo entry that does nothing.
      const buffer = stroke.buffer;
      const pixels = fillPixels(stroke, selection).filter(
        (pixel) => buffer?.data[pixel.y * buffer.width + pixel.x] !== pixel.slot,
      );
      return setPixels(stroke.layer, pixels);
    }
    // Where the press landed, not where the pointer ended up: a bucket is a
    // click, and a hand that drifted two pixels during it did not mean to
    // choose a different seed.
    return [
      {
        kind: 'fill_region',
        layer: stroke.layer,
        x: first.x,
        y: first.y,
        slot: stroke.slot,
        contiguous: true,
      },
    ];
  }

  const shape = shapeOf(stroke.tool);
  if (shape !== null) {
    if (!within(first, stroke.canvas) && !within(last, stroke.canvas)) {
      return [];
    }
    if (selection !== null) {
      return setPixels(stroke.layer, shapePixels(stroke, shape));
    }
    const closed = shape === 'rectangle' || shape === 'ellipse';
    return [
      {
        kind: 'draw_shape',
        layer: stroke.layer,
        shape: OP_SHAPES[shape],
        from: first,
        to: last,
        slot: stroke.slot,
        ...(closed ? { fill: stroke.shapeFill ?? false } : {}),
        // The op has no brush width, so a shape is always a one pixel outline
        // whatever the brush is set to. Correcting its corners is therefore
        // always right, and is what stops a diagonal reading as machine drawn.
        pixelPerfect: true,
      },
    ];
  }

  if (stroke.tool === 'move') {
    const { x, y } = moveOffset(stroke);
    if (x === 0 && y === 0) {
      return [];
    }
    if (selection === null) {
      return [{ kind: 'translate', layer: stroke.layer, dx: x, dy: y }];
    }
    const buffer = stroke.buffer;
    if (buffer === null || buffer === undefined) {
      return [];
    }
    return setPixels(stroke.layer, moveSelected(buffer, selection, x, y));
  }

  // Every other tool either writes through an op of its own above or writes
  // nothing through a stroke at all - a picker, a selection, a view tool - and
  // painting its path would put pixels on the sprite nobody drew.
  if (!isFreehand(stroke.tool)) {
    return [];
  }
  return setPixels(stroke.layer, strokePixels(stroke));
}

/**
 * One `set_pixels` op, or no batch at all for no pixels.
 *
 * @param layer - The layer written.
 * @param pixels - The writes.
 * @returns The batch.
 */
function setPixels(layer: LayerRole, pixels: PixelSet[]): Op[] {
  return pixels.length === 0 ? [] : [{ kind: 'set_pixels', layer, pixels }];
}

/**
 * Reports whether a point is on the document.
 *
 * @param point - The document pixel.
 * @param canvas - The document's size.
 * @returns True when the pixel exists.
 */
function within(point: Point, canvas: StrokeCanvas): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < canvas.width && point.y < canvas.height;
}
