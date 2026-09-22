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
 * These functions return ops. The pixels are written by Rust, composited by
 * Rust, and arrive back through `document://changed`. What
 * {@link strokePixels} produces is used for two things - building the
 * `set_pixels` op, and drawing the preview under the cursor - and both read the
 * same function, so a preview cannot show something different from what lands.
 *
 * WHY THE SLOT AND NOT A COLOUR.
 *
 * A pixel is a palette index. The pencil writes the active slot; the eraser
 * writes {@link TRANSPARENT}, which is index 0 and is not a slot at all. That
 * is why there is no colour anywhere in this file: what slot 7 looks like is a
 * property of the palette, and a stroke that carried a colour could put a
 * colour on the sprite that the palette does not contain.
 */

import { brushOffsets, linePoints, pixelPerfect } from '@/lib/pixels';
import type { BrushShape, Shape, Tool } from '@/stores/useEditorStore';
import type { LayerRole, Op, PixelSet, Point, Shape as OpShape } from '@/types/document';

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
  /** The tool, as it was when the drag began. */
  tool: Tool;
  /** The figure the shape tool would lay down, taken at the same moment. */
  shape: Shape;
  /** The layer the stroke writes to. */
  layer: LayerRole;
  /** The palette slot the stroke writes, 1 to 62. Ignored by the eraser. */
  slot: number;
  /** How many document pixels across the brush is. */
  brushSize: number;
  /** The brush's footprint above one pixel. */
  brushShape: BrushShape;
  /** Every document pixel the pointer reported, in order, first press first. */
  points: readonly Point[];
  /** The document's size, which is what a stroke is clipped to. */
  canvas: StrokeCanvas;
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

/**
 * The document pixels a freehand stroke covers.
 *
 * The pointer reports a handful of positions per second and a hand moves
 * faster than that, so consecutive reports are joined with a line rather than
 * stamped where they landed; without it a quick stroke is a row of dots.
 *
 * Pixel-perfect correction is applied only at a one pixel brush, because it
 * removes the middle pixel of a diagonal corner and a wider brush covers that
 * pixel anyway - running it there would thin the stroke rather than clean it.
 *
 * Duplicates are dropped and the first occurrence wins, so the op is as short
 * as the marks it makes. A stroke that doubles back over itself writes each
 * pixel once, which matters because the inverse Rust records for undo is the
 * region the batch overwrote and a repeated pixel would widen it for nothing.
 *
 * @param stroke - The finished drag.
 * @returns Every pixel the stroke writes, in the order it first reached them,
 *   clipped to the document.
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
  const slot = stroke.tool === 'eraser' ? TRANSPARENT : stroke.slot;

  const seen = new Set<number>();
  const pixels: PixelSet[] = [];
  for (const point of corrected) {
    for (const offset of offsets) {
      const x = point.x + offset.x;
      const y = point.y + offset.y;
      if (x < 0 || y < 0 || x >= stroke.canvas.width || y >= stroke.canvas.height) {
        continue;
      }
      const key = y * stroke.canvas.width + x;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pixels.push({ x, y, slot });
    }
  }
  return pixels;
}

/**
 * The ops that commit a finished drag.
 *
 * An empty array means the drag did nothing - a press that never landed on the
 * document, or a fill outside it - and a caller passing an empty batch to
 * `document_write_ops` would get `document.invalid_batch` back for a stroke
 * that was never made.
 *
 * The bucket and the shape tools each return one op that names what was asked
 * for rather than the pixels it produces. Rust owns flood fill and owns
 * Bresenham, and a second implementation here would be a second answer to the
 * same question - which is the arrangement that makes an agent's sprite and a
 * person's sprite differ by who drew them.
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

  if (stroke.tool === 'fill') {
    if (!within(first, stroke.canvas)) {
      return [];
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

  if (stroke.tool === 'shape') {
    if (!within(first, stroke.canvas) && !within(last, stroke.canvas)) {
      return [];
    }
    return [
      {
        kind: 'draw_shape',
        layer: stroke.layer,
        shape: OP_SHAPES[stroke.shape],
        from: first,
        to: last,
        slot: stroke.slot,
        // The op has no brush width, so a shape is always a one pixel outline
        // whatever the brush is set to. Correcting its corners is therefore
        // always right, and is what stops a diagonal reading as machine drawn.
        pixelPerfect: true,
      },
    ];
  }

  const pixels = strokePixels(stroke);
  if (pixels.length === 0) {
    return [];
  }
  return [{ kind: 'set_pixels', layer: stroke.layer, pixels }];
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
