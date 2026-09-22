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
 * Where the document sits on screen, and which document pixel a pointer is on.
 *
 * All of it is arithmetic on numbers, with no reference to the DOM, so the one
 * thing that must never be wrong - the pixel a click lands on - is testable
 * without a browser. A coordinate mapping that is off by one is invisible in a
 * screenshot and obvious in an assertion.
 *
 * THE DOCUMENT IS CENTRED, AND PAN MOVES IT FROM THERE.
 *
 * `panX` and `panY` are an offset from the centred position rather than the
 * document's absolute top left, so a viewport that changes size keeps the
 * sprite in the middle instead of leaving it pinned to a corner. Resizing a
 * window is not a request to scroll.
 *
 * ZOOM IS SCREEN PIXELS PER DOCUMENT PIXEL, and above 1 it is held to whole
 * numbers. A sprite drawn at 3.4 screen pixels per document pixel has rows
 * three pixels tall next to rows four pixels tall, which reads as a ruled
 * texture the artist did not draw. Every pixel editor snaps to integers above
 * 1 for that reason; below 1 there is no integer to snap to, so the fraction
 * stands and the sprite is simply small.
 */

import type { Point } from '@/types/document';

/** The room the stage has, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/** A document's size, in document pixels. */
export interface CanvasSize {
  width: number;
  height: number;
}

/** What the stage is looking at. */
export interface View {
  /** Screen pixels per document pixel. */
  zoom: number;
  /** Horizontal offset from the centred position, in screen pixels. */
  panX: number;
  /** Vertical offset from the centred position, in screen pixels. */
  panY: number;
}

/** Where the document is drawn, in CSS pixels within the stage. */
export interface ImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The smallest zoom the stage will hold.
 *
 * A tenth of a screen pixel per document pixel puts a 1024 pixel canvas inside
 * a 110 pixel stage, which is smaller than any stage this window can produce,
 * so nothing can zoom out past the point where fitting stops working.
 */
export const MIN_ZOOM = 0.1;

/**
 * The largest zoom the stage will hold.
 *
 * Sixty-four screen pixels per document pixel, which is Aseprite's own
 * ceiling. Past it a 48 by 64 sprite is three thousand pixels across and the
 * artist is looking at one square rather than at a sprite.
 */
export const MAX_ZOOM = 64;

/** The view a document opens on before it has been fitted to the stage. */
export const DEFAULT_VIEW: View = { zoom: 1, panX: 0, panY: 0 };

/**
 * Holds a zoom inside the supported range, and to a whole number above 1.
 *
 * @param zoom - The zoom asked for.
 * @returns The zoom the stage will actually use.
 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return bounded >= 1 ? Math.floor(bounded) : bounded;
}

/**
 * The largest zoom at which the whole document fits the stage.
 *
 * @param viewport - The room the stage has.
 * @param canvas - The document's size.
 * @returns A zoom, clamped and whole-numbered by {@link clampZoom}.
 */
export function fitZoom(viewport: Viewport, canvas: CanvasSize): number {
  if (canvas.width <= 0 || canvas.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  return clampZoom(Math.min(viewport.width / canvas.width, viewport.height / canvas.height));
}

/**
 * The view that fits the document to the stage, centred.
 *
 * @param viewport - The room the stage has.
 * @param canvas - The document's size.
 * @returns A view with no pan, because a fitted document is already centred.
 */
export function fitView(viewport: Viewport, canvas: CanvasSize): View {
  return { zoom: fitZoom(viewport, canvas), panX: 0, panY: 0 };
}

/**
 * Where the document is drawn within the stage.
 *
 * @param view - The current zoom and pan.
 * @param viewport - The room the stage has.
 * @param canvas - The document's size.
 * @returns The drawn rectangle, in CSS pixels relative to the stage's corner.
 */
export function imageRect(view: View, viewport: Viewport, canvas: CanvasSize): ImageRect {
  const width = canvas.width * view.zoom;
  const height = canvas.height * view.zoom;
  return {
    left: (viewport.width - width) / 2 + view.panX,
    top: (viewport.height - height) / 2 + view.panY,
    width,
    height,
  };
}

/**
 * Which document pixel a point in the stage is over.
 *
 * Floored rather than rounded, because a document pixel occupies a half-open
 * square: the pixel at 3 owns everything from 3.0 up to but not including 4.0,
 * and rounding would give the boundary to whichever neighbour is closer and
 * make the last half pixel of the sprite unreachable.
 *
 * @param pointer - A point in the stage, in CSS pixels from its corner.
 * @param view - The current zoom and pan.
 * @param viewport - The room the stage has.
 * @param canvas - The document's size.
 * @returns The document pixel, or null when the point is off the document.
 */
export function toCanvasPoint(
  pointer: Point,
  view: View,
  viewport: Viewport,
  canvas: CanvasSize,
): Point | null {
  const rect = imageRect(view, viewport, canvas);
  const x = Math.floor((pointer.x - rect.left) / view.zoom);
  const y = Math.floor((pointer.y - rect.top) / view.zoom);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return null;
  }
  return { x, y };
}

/**
 * Changes the zoom while holding one point of the stage still.
 *
 * Zooming about the pointer rather than about the centre is what makes a wheel
 * usable as a magnifier: the detail under the cursor is the detail the user is
 * looking at, and zooming about the centre pushes it off screen.
 *
 * @param view - The current zoom and pan.
 * @param pointer - The stage point to keep under the same document pixel.
 * @param zoom - The zoom asked for, before clamping.
 * @param viewport - The room the stage has.
 * @param canvas - The document's size.
 * @returns The new view.
 */
export function zoomAbout(
  view: View,
  pointer: Point,
  zoom: number,
  viewport: Viewport,
  canvas: CanvasSize,
): View {
  const next = clampZoom(zoom);
  const rect = imageRect(view, viewport, canvas);
  // Where the pointer is in document space, kept fractional: snapping it to a
  // whole pixel first would drift the sprite by up to a pixel per wheel notch.
  const documentX = (pointer.x - rect.left) / view.zoom;
  const documentY = (pointer.y - rect.top) / view.zoom;
  return {
    zoom: next,
    panX: pointer.x - documentX * next - (viewport.width - canvas.width * next) / 2,
    panY: pointer.y - documentY * next - (viewport.height - canvas.height * next) / 2,
  };
}

/**
 * The next zoom a wheel notch or a button press moves to.
 *
 * Doubling rather than a small factor, so the ladder is 1, 2, 4, 8 and every
 * rung is a whole number of screen pixels per document pixel. A ladder built
 * from a 1.2 factor lands on 3.58, which {@link clampZoom} then floors to 3 -
 * two notches in a row would round to the same rung and the wheel would appear
 * to stick.
 *
 * @param zoom - The zoom now.
 * @param direction - Positive to zoom in, negative to zoom out.
 * @returns The zoom to move to.
 */
export function stepZoom(zoom: number, direction: number): number {
  return clampZoom(direction > 0 ? zoom * 2 : zoom / 2);
}
