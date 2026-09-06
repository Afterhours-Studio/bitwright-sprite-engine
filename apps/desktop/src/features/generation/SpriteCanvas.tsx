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
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MIN_GRID_CELL, PixelGridOverlay } from '@/features/generation/PixelGridOverlay';

/** The gap between the well's edge and the sprite, in pixels. */
const WELL_INSET = 12;
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

  // The stage fills the room it has in the dimension that binds, and takes the
  // other from the requested shape. Sizing it in pixels rather than with an
  // aspect ratio and max constraints is what makes it actually fill: with
  // `aspect-ratio` the box sizes to its content, so a square sat small in the
  // middle of the space instead of taking it.
  const ratio = requested.width / requested.height;
  const stageWidth = width / height > ratio ? height * ratio : width;
  const stageHeight = stageWidth / ratio;

  // The sprite gets everything inside the well's own inset.
  const innerWidth = Math.max(stageWidth - WELL_INSET * 2, 0);
  const innerHeight = Math.max(stageHeight - WELL_INSET * 2, 0);
  const scale =
    image === undefined ? 0 : Math.min(innerWidth / image.width, innerHeight / image.height);
  const drawnWidth = image === undefined ? 0 : image.width * scale;
  const drawnHeight = image === undefined ? 0 : image.height * scale;

  // The scale is screen pixels per sprite pixel, which is exactly the cell size
  // the suppression rule is written against.
  const gridVisible = showPixelGrid && scale >= MIN_GRID_CELL;

  // The pattern is two sprite pixels across. Below a pixel it would be a
  // grey wash, so it stops shrinking there.
  const cellSize = image === undefined ? innerWidth / requested.width : scale;
  const checkerSize = Math.max(cellSize * 2, 4);
  const cells = image ?? requested;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      {/* Measured rather than the stage itself: the stage's size is computed
          from this, so measuring it would be measuring the answer. */}
      <div ref={ref} className="flex h-full min-h-0 w-full min-w-0 items-center justify-center">
        <div
          className={cn(
            'relative flex items-center justify-center rounded-md',
            showCheckerboard ? 'sprite-checkerboard' : 'bg-surface-well',
          )}
          style={
            {
              width: stageWidth,
              height: stageHeight,
              padding: WELL_INSET,
              // Two sprite pixels per square, so the checker lands on cell
              // boundaries instead of cutting across them.
              '--sprite-checker-size': `${String(checkerSize)}px`,
            } as CSSProperties
          }
        >
          {image === undefined ? (
            <>
              {/* The grid is drawn on the empty stage too. A 64x64 request
                  should look like 64 cells before anything exists to put in
                  them, which is what makes the canvas and the parameters agree
                  at the moment the size is chosen rather than after a run. */}
              {showPixelGrid && innerWidth / requested.width >= MIN_GRID_CELL && (
                <PixelGridOverlay
                  columns={requested.width}
                  rows={requested.height}
                  width={innerWidth}
                  height={innerHeight}
                />
              )}
              <div className="pointer-events-none rounded-md border border-line-subtle bg-surface-content px-4 py-3 text-center shadow-sm">
                <p className="text-sm text-fg-primary">{t('canvas.empty')}</p>
                <p className="mt-1 text-xs text-fg-secondary">{t('canvas.hint')}</p>
              </div>
            </>
          ) : (
            <div className="relative" style={{ width: drawnWidth, height: drawnHeight }}>
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
                  columns={cells.width}
                  rows={cells.height}
                  width={drawnWidth}
                  height={drawnHeight}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
