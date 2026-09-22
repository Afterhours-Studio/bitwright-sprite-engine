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
 * Which document pixel a pointer is on.
 *
 * This is the one calculation in the editor that has to be exactly right and
 * that a screenshot cannot check: a mapping off by one puts every mark one
 * pixel from where it was aimed, which looks like a steady hand drawing
 * slightly wrong rather than like a bug. It is arithmetic with no DOM in it
 * precisely so it can be asserted on.
 */

import { describe, expect, it } from 'vitest';

import {
  clampZoom,
  fitView,
  fitZoom,
  imageRect,
  stepZoom,
  toCanvasPoint,
  zoomAbout,
  MAX_ZOOM,
  MIN_ZOOM,
} from '@/features/editor/canvas/view';

/** A stage with room to spare around a small sprite. */
const VIEWPORT = { width: 400, height: 300 };

/** The canvas the HD-2D preset creates a character at. */
const CANVAS = { width: 48, height: 64 };

describe('clampZoom', () => {
  it('holds a zoom above one to a whole number', () => {
    // A sprite drawn at 3.4 screen pixels per document pixel has rows three
    // pixels tall beside rows four pixels tall, which reads as a ruled texture
    // nobody drew.
    expect(clampZoom(3.4)).toBe(3);
    expect(clampZoom(8)).toBe(8);
  });

  it('leaves a zoom below one as the fraction it is', () => {
    expect(clampZoom(0.5)).toBe(0.5);
  });

  it('holds the ends of the range', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('fitZoom', () => {
  it('takes the dimension that binds', () => {
    // 300 / 64 is 4.68 and 400 / 48 is 8.33, so height binds and the whole
    // number below it is 4.
    expect(fitZoom(VIEWPORT, CANVAS)).toBe(4);
  });

  it('answers something usable before the stage has been laid out', () => {
    expect(fitZoom({ width: 0, height: 0 }, CANVAS)).toBe(1);
  });
});

describe('imageRect', () => {
  it('centres the document when nothing has been panned', () => {
    const rect = imageRect(fitView(VIEWPORT, CANVAS), VIEWPORT, CANVAS);

    expect(rect).toEqual({ left: (400 - 192) / 2, top: (300 - 256) / 2, width: 192, height: 256 });
  });

  it('moves the document by the pan and not to it', () => {
    const rect = imageRect({ zoom: 4, panX: 10, panY: -5 }, VIEWPORT, CANVAS);

    expect(rect.left).toBe((400 - 192) / 2 + 10);
    expect(rect.top).toBe((300 - 256) / 2 - 5);
  });
});

describe('toCanvasPoint', () => {
  const view = { zoom: 4, panX: 0, panY: 0 };
  const rect = imageRect(view, VIEWPORT, CANVAS);

  it('maps the first pixel of the document to zero', () => {
    expect(toCanvasPoint({ x: rect.left, y: rect.top }, view, VIEWPORT, CANVAS)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('gives a pixel the whole square it occupies', () => {
    // Everything from 3.0 up to but not including 4.0 belongs to pixel 3.
    // Rounding instead would hand the boundary to the nearer neighbour and
    // leave the last half pixel of the sprite unreachable.
    for (const offset of [0, 1, 2, 3.9]) {
      expect(
        toCanvasPoint({ x: rect.left + 12 + offset, y: rect.top }, view, VIEWPORT, CANVAS),
      ).toEqual({ x: 3, y: 0 });
    }
    expect(toCanvasPoint({ x: rect.left + 16, y: rect.top }, view, VIEWPORT, CANVAS)).toEqual({
      x: 4,
      y: 0,
    });
  });

  it('maps the last pixel and not one past it', () => {
    expect(
      toCanvasPoint(
        { x: rect.left + rect.width - 1, y: rect.top + rect.height - 1 },
        view,
        VIEWPORT,
        CANVAS,
      ),
    ).toEqual({ x: 47, y: 63 });
    expect(
      toCanvasPoint({ x: rect.left + rect.width, y: rect.top }, view, VIEWPORT, CANVAS),
    ).toBeNull();
  });

  it('reports nothing for a point off the document', () => {
    expect(toCanvasPoint({ x: 0, y: 0 }, view, VIEWPORT, CANVAS)).toBeNull();
    expect(toCanvasPoint({ x: rect.left - 1, y: rect.top }, view, VIEWPORT, CANVAS)).toBeNull();
  });

  it('follows the pan, so a scrolled sprite is still hit where it is drawn', () => {
    const panned = { zoom: 4, panX: 40, panY: 20 };
    const moved = imageRect(panned, VIEWPORT, CANVAS);

    expect(
      toCanvasPoint({ x: moved.left + 8, y: moved.top + 8 }, panned, VIEWPORT, CANVAS),
    ).toEqual({ x: 2, y: 2 });
  });
});

describe('zoomAbout', () => {
  it('keeps the pixel under the pointer under the pointer', () => {
    const before = { zoom: 2, panX: 0, panY: 0 };
    const pointer = { x: 260, y: 190 };
    const under = toCanvasPoint(pointer, before, VIEWPORT, CANVAS);

    const after = zoomAbout(before, pointer, 8, VIEWPORT, CANVAS);

    expect(after.zoom).toBe(8);
    expect(toCanvasPoint(pointer, after, VIEWPORT, CANVAS)).toEqual(under);
  });

  it('clamps the zoom it was asked for and still holds the point', () => {
    const before = { zoom: 4, panX: 0, panY: 0 };
    const pointer = { x: 210, y: 150 };
    const under = toCanvasPoint(pointer, before, VIEWPORT, CANVAS);

    const after = zoomAbout(before, pointer, 1000, VIEWPORT, CANVAS);

    expect(after.zoom).toBe(MAX_ZOOM);
    expect(toCanvasPoint(pointer, after, VIEWPORT, CANVAS)).toEqual(under);
  });
});

describe('stepZoom', () => {
  it('doubles and halves, so every rung is a whole number', () => {
    expect(stepZoom(4, 1)).toBe(8);
    expect(stepZoom(4, -1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
  });

  it('stops at the ends rather than walking past them', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});
