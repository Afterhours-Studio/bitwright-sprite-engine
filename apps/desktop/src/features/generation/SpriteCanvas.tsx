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
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MIN_GRID_CELL, PixelGridOverlay } from '@/features/generation/PixelGridOverlay';
import { useElementSize } from '@/hooks/useElementSize';
import { toDataUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { SpriteImage } from '@/types/engine';

export interface SpriteCanvasProps {
  /** The sprite being looked at, or `undefined` before the first run. */
  image: SpriteImage | undefined;
  /** Whether a line is drawn at every sprite pixel boundary. */
  showPixelGrid: boolean;
  /** Whether transparent pixels read as a checker pattern. */
  showCheckerboard: boolean;
  /**
   * The size the parameters currently ask for.
   *
   * The stage takes its shape from this rather than from the sprite, so the
   * canvas states the size that was asked for before anything exists to show,
   * and keeps stating it while a request is edited.
   */
  requested: { width: number; height: number };
}

/**
 * Works out how large to draw a sprite in the room available.
 *
 * THE SCALE IS A WHOLE NUMBER, and that is the whole point of the function. A
 * fractional scale on pixel art gives some sprite pixels one more screen pixel
 * than their neighbours, so a sprite drawn at 7.4x has rows that are visibly
 * fatter than the rows beside them - which is the exact artifact the
 * application exists to remove, reintroduced by the viewer. Every pixel editor
 * surveyed restricts zoom to integers and reciprocals for this reason.
 *
 * A whole scale also puts every sprite pixel boundary on a whole CSS pixel, so
 * the grid overlay lands on the same boundaries the browser's own
 * nearest-neighbour upscale does.
 *
 * The floor is one. A sprite larger than the room it has is shown at its own
 * size and allowed to overflow rather than being shrunk below one screen pixel
 * per sprite pixel, because a downscale of pixel art is worse than a scrollbar.
 *
 * @param image - The sprite, or `undefined` when there is none.
 * @param width - Room available across, in CSS pixels.
 * @param height - Room available down, in CSS pixels.
 * @returns Screen pixels per sprite pixel. At least one.
 */
function spriteScale(image: SpriteImage | undefined, width: number, height: number): number {
  if (image === undefined || image.width <= 0 || image.height <= 0) {
    return 1;
  }
  // Before the first layout pass the room is reported as zero, and a zero
  // divided into anything is a scale of zero. One is the honest answer until
  // there is a measurement.
  if (width <= 0 || height <= 0) {
    return 1;
  }
  const fit = Math.min(width / image.width, height / image.height);
  return Math.max(1, Math.floor(fit));
}

/**
 * The stage: the sprite being worked on, as large as the room allows.
 *
 * The checkerboard sits on the well surface, which is decorative and carries no
 * text of its own. It is wrapped in a content card, so the well is nested
 * inside a text-bearing surface rather than sitting straight on the canvas;
 * that is the adjacency the token file declares.
 *
 * Sprites are scaled with nearest neighbour, because smoothing a 64 pixel
 * sprite up to display size destroys the thing being made.
 *
 * ONE SPRITE, NOT THE WHOLE BATCH. The stage used to lay every image from the
 * run out in a row, which meant a batch of four was four sprites at a quarter
 * of the size each, on the screen whose entire job is showing one sprite
 * properly. The rest of the batch is in the preview rail beside it, and
 * pressing one there brings it here.
 *
 * The checkerboard is a fixed screen size and does not scale with the sprite.
 * Scaling it makes it read as part of the art, which is why no editor does it.
 */
export function SpriteCanvas({
  image,
  showPixelGrid,
  showCheckerboard,
  requested,
}: SpriteCanvasProps): ReactElement {
  const { t } = useTranslation('generation');
  const { ref, width, height } = useElementSize();

  const scale = spriteScale(image, width, height);
  // The scale is screen pixels per sprite pixel, which is exactly the cell size
  // the suppression rule is written against.
  const gridVisible = showPixelGrid && image !== undefined && scale >= MIN_GRID_CELL;

  return (
    // A column inside the canvas container, not a card of its own. The frame
    // and the background belong to the container that holds both columns, so
    // the sprite and the tools beside it read as one view rather than as two
    // panels that happen to be adjacent.
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <div
        className={cn(
          // The inset is 12px rather than 24. Every pixel of it comes off the
          // sprite: at the default window a 64 pixel sprite lands on 6 screen
          // pixels per sprite pixel with about a dozen to spare, and 24px of
          // padding on each side is what takes it below the threshold where the
          // pixel grid can be drawn at all. The well's own edge is what holds
          // the sprite off the card; it does not need a wide margin as well.
          'flex max-h-full max-w-full items-center justify-center rounded-md p-3',
          showCheckerboard ? 'sprite-checkerboard' : 'bg-surface-well',
        )}
        // The stage takes the shape of the sprite that was asked for, and is
        // capped by the room available, so a 64x64 request is a square before
        // anything has been generated. Filling whatever space is free is what
        // presented a square sprite in a landscape frame and made the canvas
        // disagree with the size named in the parameters.
        style={{ aspectRatio: `${String(requested.width)} / ${String(requested.height)}` }}
      >
        {/* Measured rather than the padded box above it, so the number the
            scale is worked out from is the room a sprite can actually occupy.
            `min-h-0` and `min-w-0` are what let it shrink: a flex item's
            automatic minimum is its content, so without them the stage would
            grow to fit the sprite instead of the sprite fitting the stage. */}
        <div
          ref={ref}
          className="flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-auto"
        >
          {image === undefined ? (
            <div className="rounded-md border border-line-subtle bg-surface-content px-4 py-3 text-center shadow-sm">
              <p className="text-sm text-fg-primary">{t('canvas.empty')}</p>
              <p className="mt-1 text-xs text-fg-secondary">{t('canvas.hint')}</p>
            </div>
          ) : (
            <div
              className="relative shrink-0"
              style={{ width: image.width * scale, height: image.height * scale }}
            >
              <img
                src={toDataUrl(image.data)}
                width={image.width}
                height={image.height}
                alt={t('title')}
                className="block h-full w-full"
                style={{ imageRendering: 'pixelated' }}
              />
              {gridVisible && (
                <PixelGridOverlay
                  columns={image.width}
                  rows={image.height}
                  width={image.width * scale}
                  height={image.height * scale}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
