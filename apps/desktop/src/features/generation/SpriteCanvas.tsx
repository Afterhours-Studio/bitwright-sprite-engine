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
import { useCallback, useState, type ReactElement } from 'react';
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
  const [available, setAvailable] = useState(0);

  // The room the column sits in, read from the node as it is attached. The
  // column is about to become the answer, so measuring the column itself
  // would be measuring the answer and the two would chase each other.
  const attach = useCallback(
    (node: HTMLElement | null) => {
      ref(node);
      setAvailable(node?.parentElement?.clientWidth ?? 0);
    },
    [ref],
  );

  // The stage fills the room it has in the dimension that binds, and takes the
  // other from the requested shape. Sizing it in pixels rather than with an
  // aspect ratio and max constraints is what makes it actually fill: with
  // `aspect-ratio` the box sizes to its content, so a square sat small in the
  // middle of the space instead of taking it.
  const ratio = requested.width / requested.height;
  const measured = width > 0 && height > 0;
  // The cap is the room the column sits in rather than the column itself: the
  // column is about to become the answer, so measuring it would be measuring
  // the answer and the two would chase each other.
  const stageWidth = Math.min(height * ratio, available > 0 ? available : width);
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
  // One square per sprite pixel, so the pattern reads as the grid rather
  // than as a texture behind it. Below four pixels it is a grey wash, so it
  // stops shrinking there.
  const cellSize = image === undefined ? innerWidth / requested.width : scale;
  const checkerSize = Math.max(cellSize * 2, 4);
  const cells = image ?? requested;

  return (
    // Only as wide as the square it holds, once there is a measurement to
    // size it by. Filling the row left the next column's rule stranded away
    // from the stage with a band of empty canvas between them, which reads
    // as a gap rather than as a divider.
    <div
      className={cn(
        'flex min-h-0 items-center justify-center',
        measured ? 'shrink-0' : 'min-w-0 flex-1',
      )}
      style={measured ? { width: stageWidth } : undefined}
    >
      {/* Measured rather than the stage itself: the stage's size is computed
          from this, so measuring it would be measuring the answer. */}
      <div ref={attach} className="flex h-full min-h-0 w-full min-w-0 items-center justify-center">
        <div
          className={cn('relative flex items-center justify-center rounded-md bg-surface-well')}
          style={{ width: stageWidth, height: stageHeight, padding: WELL_INSET }}
        >
          {image === undefined ? (
            <>
              {/* One box holds both, inset to where the sprite would be. The
                  grid canvas positions itself with `inset-0`, so anchoring the
                  two patterns to different boxes is what put them twelve pixels
                  out of step. The grid is the authority: it draws exactly the
                  number of cells the request names. */}
              <div className="absolute" style={{ inset: WELL_INSET }}>
                {showCheckerboard && (
                  <div
                    className="sprite-checkerboard absolute inset-0"
                    style={{ ['--sprite-checker-size' as string]: `${String(checkerSize)}px` }}
                  />
                )}
                {showPixelGrid && innerWidth / requested.width >= MIN_GRID_CELL && (
                  <PixelGridOverlay
                    columns={requested.width}
                    rows={requested.height}
                    width={innerWidth}
                    height={innerHeight}
                  />
                )}
              </div>
              <div className="pointer-events-none relative rounded-md border border-line-subtle bg-surface-content px-4 py-3 text-center shadow-sm">
                <p className="text-sm text-fg-primary">{t('canvas.empty')}</p>
                <p className="mt-1 text-xs text-fg-secondary">{t('canvas.hint')}</p>
              </div>
            </>
          ) : (
            <div className="relative" style={{ width: drawnWidth, height: drawnHeight }}>
              {showCheckerboard && (
                <div
                  className="sprite-checkerboard absolute inset-0"
                  style={{ ['--sprite-checker-size' as string]: `${String(checkerSize)}px` }}
                />
              )}
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
