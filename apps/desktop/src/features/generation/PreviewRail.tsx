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
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { toDataUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { SpriteImage } from '@/types/engine';

export interface PreviewRailProps {
  /** Every sprite the last run produced. */
  images: SpriteImage[];
  /** Which of them the stage is showing. */
  selected: number;
  /** Called with the index of the sprite to show on the stage. */
  onSelect: (index: number) => void;
}

/**
 * The display rail beside the stage.
 *
 * WHY THIS SPACE EXISTS AT ALL. The sprite is square and the content area is
 * wide, so a sprite centred in it leaves a column of dead space at each side at
 * every window size. Rather than leave it empty, it holds what Aseprite calls
 * its Preview window: the sprite at one screen pixel per sprite pixel, which is
 * the only view that tells the truth about what was made and the one you cannot
 * see while the stage is filling itself with a magnified copy.
 *
 * IT DISPLAYS; IT DOES NOT EDIT. Nothing here changes an image or the request.
 * Pressing a sprite in the batch strip changes which one the stage is showing
 * and nothing else, which is the same kind of act as choosing a tool.
 *
 * IT IS 200px WIDE, NARROWS TO 160 UNDER 1280, AND IS GONE UNDER 1024, which is
 * the table in the pixel editing plan with its middle case simplified: the plan
 * has the rail collapse to a tab on the stage's edge between 1024 and 1200, and
 * a narrower rail says the same thing without a second mechanism to build,
 * learn and maintain.
 *
 * The disappearance below 1024 is measured rather than chosen for tidiness. At
 * the 960 pixel window minimum the stage is 366 pixels of usable width with the
 * rail showing, which puts a 64 pixel sprite at 5x - under the six screen
 * pixels per sprite pixel the grid needs, so the grid suppresses itself. With
 * the rail gone the stage takes that width back and the sprite lands at 6x with
 * the grid on. Nothing is lost permanently: what the rail shows is a view of
 * images that are still there, and widening the window brings it back.
 */
export function PreviewRail({ images, selected, onSelect }: PreviewRailProps): ReactElement {
  const { t } = useTranslation('generation');
  const image = images[selected];

  return (
    <aside className="hidden w-40 shrink-0 flex-col gap-4 lg:flex xl:w-[200px]">
      <RailCell title={t('canvas.actualSize')}>
        {image === undefined ? (
          <p className="px-2 py-6 text-center text-xs text-fg-secondary">{t('canvas.railEmpty')}</p>
        ) : (
          <div className="sprite-checkerboard flex min-h-24 items-center justify-center overflow-auto rounded-sm p-2">
            {/* No width or height style at all: the intrinsic attributes are
                the sprite's own pixel count, so the browser draws it at exactly
                one screen pixel per sprite pixel. That is the whole point of
                this cell, and any styling of its size would defeat it. A sprite
                wider than the rail scrolls rather than being shrunk. */}
            <img
              src={toDataUrl(image.data)}
              width={image.width}
              height={image.height}
              alt={t('canvas.actualSize')}
              className="block shrink-0"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        )}
      </RailCell>

      {/* Only when there is a batch to choose from. A strip offering one
          sprite is a control with nothing to decide. */}
      {images.length > 1 && (
        <RailCell title={t('canvas.batch')}>
          <div className="grid grid-cols-2 gap-2">
            {images.map((sprite, index) => (
              <button
                key={`${String(index)}-${String(sprite.width)}x${String(sprite.height)}`}
                type="button"
                aria-label={t('canvas.selectSprite', { index: index + 1 })}
                aria-current={index === selected}
                onClick={() => {
                  onSelect(index);
                }}
                className={cn(
                  'sprite-checkerboard flex aspect-square items-center justify-center',
                  'rounded-sm border p-1 transition-colors',
                  index === selected
                    ? 'border-accent'
                    : 'border-transparent hover:border-line-strong',
                )}
              >
                <img
                  src={toDataUrl(sprite.data)}
                  width={sprite.width}
                  height={sprite.height}
                  alt=""
                  className="max-h-full max-w-full"
                  style={{ imageRendering: 'pixelated' }}
                />
              </button>
            ))}
          </div>
        </RailCell>
      )}
    </aside>
  );
}

interface RailCellProps {
  /** What the cell shows. Always a translated string. */
  title: string;
  /** The cell's body. */
  children: ReactNode;
}

/**
 * One cell of the rail.
 *
 * The same card the stage wears, at the same padding, so the rail reads as a
 * row of siblings of the stage rather than as a different kind of object
 * parked next to it.
 */
function RailCell({ title, children }: RailCellProps): ReactElement {
  return (
    <section className="flex min-h-0 flex-col gap-2 rounded-lg border border-line-subtle bg-surface-content p-2 shadow-sm">
      <h2 className="px-1 text-xs font-medium text-fg-secondary">{title}</h2>
      {children}
    </section>
  );
}
