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
 * The two painted layers of the stage: the document, and the stroke being made
 * over it.
 *
 * NEAREST NEIGHBOUR, AT EVERY ZOOM.
 *
 * Each canvas element's backing store is exactly the document's size in
 * document pixels, and the element is then stretched by CSS to its drawn size.
 * Nothing is resampled when the image is written, and `image-rendering:
 * pixelated` is what tells the compositor to magnify by repetition rather than
 * by interpolation. That combination is the only one that holds at a
 * fractional device pixel ratio: a canvas sized in device pixels and drawn
 * with `drawImage` still lands sprite pixel boundaries on fractions of a
 * device pixel, and the smoothing that follows is exactly the blur this screen
 * may never show.
 *
 * The context is fetched and checked for null on every draw, because jsdom
 * returns null rather than a 2D context. That guard is what lets the editor
 * mount under Vitest instead of being stubbed out of the tests that matter.
 */

import { useEffect, useRef, type ReactElement } from 'react';

import { toHexa } from '@/features/editor/colour';
import type { PixelSet, RgbaImage } from '@/types/document';

/**
 * How opaque the stroke under the cursor is drawn, as a byte.
 *
 * Seven tenths: enough that the mark reads as the slot's colour, little enough
 * that it reads as provisional rather than as already committed.
 */
const PREVIEW_ALPHA = 179;

/** The eraser's footprint is drawn fainter still, because it leaves a hole. */
const ERASE_ALPHA = 90;

/** What the eraser's footprint is drawn in: white, at {@link ERASE_ALPHA}. */
const ERASE_INK: readonly [number, number, number, number] = [255, 255, 255, 255];

export interface DocumentSurfaceProps {
  /** The composited document, in straight sRGB bytes. */
  image: RgbaImage;
  /** The drawn width, in CSS pixels. */
  width: number;
  /** The drawn height, in CSS pixels. */
  height: number;
  /** What a screen reader is told this is. */
  label: string;
}

/**
 * The composited document.
 *
 * @param props - The image and the size to draw it at.
 * @returns The canvas holding the sprite.
 */
export function DocumentSurface({
  image,
  width,
  height,
  label,
}: DocumentSurfaceProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) {
      return;
    }
    element.width = image.width;
    element.height = image.height;

    const context = element.getContext('2d');
    if (context === null) {
      return;
    }
    // `data` crosses the IPC boundary as a JSON number array, which is what
    // Tauri makes of a `Vec<u8>`. `ImageData` wants a clamped array, and the
    // copy is one pass over four bytes per pixel - a 48 by 64 sprite is twelve
    // thousand of them, which is not close to being the slow part of anything.
    const bytes = new Uint8ClampedArray(image.data);
    if (bytes.length !== image.width * image.height * 4) {
      // A buffer that does not match its own stated size would throw out of
      // `ImageData` and take the editor down with it. It cannot happen while
      // Rust is the only producer, which is why it leaves the last good
      // picture alone rather than reporting anything.
      return;
    }
    context.putImageData(new ImageData(bytes, image.width, image.height), 0, 0);
  }, [image]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className="absolute inset-0"
      style={{ width, height, imageRendering: 'pixelated' }}
    />
  );
}

export interface StrokePreviewProps {
  /** The pixels the stroke would write, in document coordinates. */
  pixels: readonly PixelSet[];
  /** The document's size, which is the canvas's own resolution. */
  canvas: { width: number; height: number };
  /** The active slot's colour, as straight sRGB bytes. */
  rgba: readonly [number, number, number, number];
  /** True when the stroke erases, which draws as a hole rather than as ink. */
  erasing: boolean;
  /** The drawn width, in CSS pixels. */
  width: number;
  /** The drawn height, in CSS pixels. */
  height: number;
}

/**
 * The stroke under the cursor, before it has been committed.
 *
 * WHY THERE IS A PREVIEW AT ALL, given that Rust owns the pixels: a stroke
 * commits on release, and a freehand line that appears only once the hand has
 * stopped is a pencil that cannot be aimed. The preview shows the same pixels
 * the op will carry, because both come out of `strokePixels`, so it cannot
 * promise a mark the document will not get.
 *
 * WHY ONLY THE FREEHAND TOOLS have one: a bucket's reach and a shape's
 * Bresenham are decided in Rust, and guessing at them here would be a second
 * implementation that is wrong in exactly the cases the two disagree.
 *
 * The eraser draws its footprint rather than nothing, because a preview of an
 * erase that showed nothing would be indistinguishable from a tool that is not
 * working. It is drawn as a wash rather than in the slot's colour, since what
 * it leaves behind is a hole and not a mark.
 *
 * @param props - The pixels, the document size, and the drawn size.
 * @returns The overlay canvas.
 */
export function StrokePreview({
  pixels,
  canvas,
  rgba,
  erasing,
  width,
  height,
}: StrokePreviewProps): ReactElement {
  const element = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = element.current;
    if (node === null) {
      return;
    }
    node.width = canvas.width;
    node.height = canvas.height;

    const context = node.getContext('2d');
    if (context === null) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (pixels.length === 0) {
      return;
    }
    // Assembled from bytes rather than written as a colour, for the reason in
    // `features/editor/colour.ts`: these bytes came out of the document's own
    // palette and are a pixel of the sprite, not a piece of the interface.
    context.fillStyle = erasing ? toHexa(ERASE_INK, ERASE_ALPHA) : toHexa(rgba, PREVIEW_ALPHA);
    for (const pixel of pixels) {
      context.fillRect(pixel.x, pixel.y, 1, 1);
    }
  }, [pixels, canvas.width, canvas.height, rgba, erasing]);

  return (
    <canvas
      ref={element}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ width, height, imageRendering: 'pixelated' }}
    />
  );
}
