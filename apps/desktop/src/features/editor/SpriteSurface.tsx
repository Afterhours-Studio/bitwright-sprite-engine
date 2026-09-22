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

import { useCallback, useEffect, useRef, type PointerEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { toDataUrl } from '@/lib/api';
import { decodePng } from '@/lib/png';
import { spritePoint, withinSprite, type Point } from '@/lib/pixels';
import { useCanvasStore } from '@/stores/useCanvasStore';
import type { SpriteImage } from '@/types/engine';

export interface SpriteSurfaceProps {
  /** The sprite being worked on. */
  image: SpriteImage;
  /** Which sprite of the batch it is, which is how the buffer is identified. */
  index: number;
  /** The drawn width of the sprite, in CSS pixels. */
  width: number;
  /** The drawn height, in CSS pixels. */
  height: number;
}

/**
 * The sprite itself, and the thing a stroke lands on.
 *
 * A canvas the size of the sprite, scaled up by CSS with nearest neighbour,
 * rather than a canvas the size of the stage. That is what guarantees a stroke
 * cannot land on a fraction of a pixel: there is no fraction of a pixel to
 * land on, because the drawing surface has exactly as many pixels as the
 * sprite does and the scaling happens after everything is drawn.
 *
 * Pointer positions are turned into sprite pixels through the element's
 * measured box rather than through the size this was told to draw at. The two
 * agree in a browser to within a rounding error, and a rounding error is a
 * whole sprite pixel at low zoom.
 *
 * The image element is what shows until the bytes have been decoded, and the
 * only thing that shows where there is no canvas at all, such as under test.
 * A sprite that cannot be painted on is still a sprite that has to be seen.
 */
export function SpriteSurface({ image, index, width, height }: SpriteSurfaceProps): ReactElement {
  const { t } = useTranslation('generation');
  const canvas = useRef<HTMLCanvasElement>(null);

  const pixels = useCanvasStore((state) => state.pixels);
  const selection = useCanvasStore((state) => state.selection);
  const adopt = useCanvasStore((state) => state.adopt);
  const begin = useCanvasStore((state) => state.begin);
  const extend = useCanvasStore((state) => state.extend);
  const finish = useCanvasStore((state) => state.finish);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  // Decoded once per sprite. The buffer is the truth from then on, so a sprite
  // that is already adopted - including one this editor published itself - is
  // not decoded again, which is what stops a stroke from being undone by its
  // own trip through the generation store.
  useEffect(() => {
    const current = useCanvasStore.getState();
    if (current.index === index && current.origin === image.data) {
      return;
    }

    let stale = false;
    void decodePng(image.data).then((decoded) => {
      if (!stale && decoded !== null) {
        adopt(index, image.data, decoded);
      }
    });

    return () => {
      stale = true;
    };
  }, [adopt, index, image.data]);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || pixels === null) {
      return;
    }
    // Null under jsdom, which has no 2D context. The guard is what lets the
    // screens render in a test rather than the component being stubbed out of
    // them.
    const context = element.getContext('2d');
    if (context === null) {
      return;
    }
    context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  }, [pixels]);

  // On the window rather than on the canvas, because a canvas is not something
  // that takes focus and undo has to work wherever the pointer happens to be.
  // A field is left alone: the same chord is how a browser undoes typing, and
  // taking it away from the prompt would be worse than not having it here.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || editingText(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [redo, undo]);

  /**
   * Turns a pointer event into the sprite pixel under it.
   *
   * @param event - The pointer event.
   * @returns The pixel, or null before there is a buffer to address.
   */
  const pointAt = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): Point | null => {
      const element = canvas.current;
      if (element === null || pixels === null) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return spritePoint(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        { width: box.width, height: box.height },
        pixels,
      );
    },
    [pixels],
  );

  // Screen pixels per sprite pixel, taken in each direction rather than once:
  // the stage keeps the sprite's shape, but a rounded box can leave the two a
  // fraction apart and a marquee drawn from one of them would drift across the
  // sprite.
  const across = pixels === null || pixels.width === 0 ? 0 : width / pixels.width;
  const down = pixels === null || pixels.height === 0 ? 0 : height / pixels.height;

  return (
    <>
      {pixels === null ? (
        <img
          src={toDataUrl(image.data)}
          width={image.width}
          height={image.height}
          alt={t('title')}
          className="relative block h-full w-full"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <canvas
          ref={canvas}
          width={pixels.width}
          height={pixels.height}
          role="img"
          aria-label={t('canvas.surface')}
          // `touch-none` so that a drag on a touch screen draws rather than
          // scrolling the screen out from under the stroke.
          className="relative block h-full w-full cursor-crosshair touch-none"
          style={{ imageRendering: 'pixelated' }}
          onPointerDown={(event) => {
            const point = pointAt(event);
            if (point === null || !withinSprite(point, pixels)) {
              return;
            }
            // Captured, so a drag that leaves the sprite keeps reporting to
            // this element and the stroke ends where the pointer is released
            // rather than wherever it happened to cross the edge.
            event.currentTarget.setPointerCapture(event.pointerId);
            begin(point);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              return;
            }
            const point = pointAt(event);
            if (point !== null) {
              extend(point);
            }
          }}
          onPointerUp={(event) => {
            // Only what was captured is released. A press that began on the
            // well beside the sprite and ended over it arrives here with no
            // capture, and releasing one that was never taken throws.
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            finish();
          }}
          onPointerCancel={() => {
            // A cancelled pointer is still a stroke that was drawn, and
            // throwing it away would lose work the person watched appear.
            finish();
          }}
        />
      )}

      {selection !== null && across > 0 && down > 0 && (
        <div
          aria-hidden="true"
          // Dashed, like every selection marquee, and drawn on the pixel
          // boundary the selection actually has: a region that looked half a
          // pixel out would be a region nobody could trust.
          className="pointer-events-none absolute border border-dashed border-line-focus"
          style={{
            left: selection.x * across,
            top: selection.y * down,
            width: selection.width * across,
            height: selection.height * down,
          }}
        />
      )}
    </>
  );
}

/**
 * Reports whether a key press belongs to a text field.
 *
 * @param target - What the event was aimed at.
 * @returns True when the field should keep the chord.
 */
function editingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
