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

import { toDataUrl } from '@/lib/api';
import type { SpriteImage } from '@/types/engine';

export interface SpriteCanvasProps {
  /** Sprites from the last run. */
  images: SpriteImage[];
}

/**
 * The main viewing area.
 *
 * The checkerboard sits on the well surface, which is decorative and carries no
 * text of its own. It is wrapped in a content card, so the well is nested
 * inside a text-bearing surface rather than sitting straight on the canvas;
 * that is the adjacency the token file declares.
 *
 * Sprites are scaled with nearest neighbour, because smoothing a 64 pixel
 * sprite up to display size destroys the thing being made.
 */
export function SpriteCanvas({ images }: SpriteCanvasProps): ReactElement {
  const { t } = useTranslation('generation');

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-line-subtle bg-surface-content p-2 shadow-sm">
      <div className="sprite-checkerboard flex min-h-64 flex-1 items-center justify-center gap-4 rounded-md p-6">
        {images.length === 0 ? (
          <div className="rounded-md border border-line-subtle bg-surface-content px-4 py-3 text-center shadow-sm">
            <p className="text-sm text-fg-primary">{t('canvas.empty')}</p>
            <p className="mt-1 text-xs text-fg-secondary">{t('canvas.hint')}</p>
          </div>
        ) : (
          images.map((image, index) => (
            <img
              key={`${index}-${image.width}x${image.height}`}
              src={toDataUrl(image.data)}
              width={image.width}
              height={image.height}
              alt={t('title')}
              style={{ imageRendering: 'pixelated', width: 256, height: 'auto' }}
            />
          ))
        )}
      </div>
    </div>
  );
}
