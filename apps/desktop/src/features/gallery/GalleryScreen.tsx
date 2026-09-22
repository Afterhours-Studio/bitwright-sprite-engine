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
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { useSpriteStore } from '@/stores/useSpriteStore';
import { useShellStore } from '@/stores/useShellStore';
import { Pill } from '@/components/ui/Pill';
import { toDataUrl } from '@/lib/api';
import { useGalleryStore, visibleItems, type GalleryFilter } from '@/stores/useGalleryStore';

const FILTERS: readonly GalleryFilter[] = ['all', 'favourites'];

/** The gallery: every sprite in the sprites directory, newest first. */
export function GalleryScreen(): ReactElement {
  const { t } = useTranslation();

  const items = useGalleryStore((state) => state.items);
  const openSprite = useSpriteStore((state) => state.open);
  const setScreen = useShellStore((state) => state.setScreen);
  const filter = useGalleryStore((state) => state.filter);
  const setFilter = useGalleryStore((state) => state.setFilter);
  const toggleFavourite = useGalleryStore((state) => state.toggleFavourite);
  const remove = useGalleryStore((state) => state.remove);
  const load = useGalleryStore((state) => state.load);

  // The list comes from the engine, so there is nothing to ask for until the
  // engine is answering. Re-read on every visit rather than once at startup:
  // the directory is the record, and a sprite written or deleted since the
  // last look is exactly what someone opening the gallery came to see.
  const engineReady = useShellStore((state) => state.sidecar.ready);
  useEffect(() => {
    if (engineReady) {
      void load();
    }
  }, [engineReady, load]);

  const shown = visibleItems(items, filter);

  return (
    <section className="flex h-full flex-col gap-4 overflow-auto p-4">
      <header>
        <h1 className="text-base font-semibold text-fg-primary">{t('gallery.title')}</h1>
        <p className="text-xs text-fg-secondary">{t('gallery.subtitle')}</p>
      </header>

      {/* A secondary pill row, so its active state is the anchor colour rather
          than the accent. Only the primary navigation is allowed to be yellow. */}
      <div className="flex w-fit items-center gap-2">
        {FILTERS.map((option) => (
          <Pill
            key={option}
            tone="anchor"
            active={filter === option}
            onClick={() => {
              setFilter(option);
            }}
          >
            {option === 'all' ? t('gallery.filterAll') : t('gallery.filterFavourites')}
          </Pill>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-line-subtle bg-surface-content p-8 text-center shadow-sm">
          <p className="text-sm text-fg-primary">{t('empty.title')}</p>
          <p className="mt-1 text-xs text-fg-secondary">{t('empty.description')}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 overflow-auto">
          {shown.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-line-subtle bg-surface-content p-2 shadow-sm"
            >
              <div className="sprite-checkerboard flex items-center justify-center rounded-md p-2">
                <img
                  src={toDataUrl(item.image.data)}
                  width={item.image.width}
                  height={item.image.height}
                  alt={item.id}
                  style={{ imageRendering: 'pixelated', width: 128, height: 'auto' }}
                />
              </div>
              {/* The file name, which is what a sprite is called everywhere
                  else: in the folder this list reads, in the editor's save,
                  and in whatever the user does with it afterwards. Titled as
                  well as shown, because the names are long enough to truncate
                  and the tail is the part that differs. */}
              <p className="truncate text-xs text-fg-secondary" title={item.id}>
                {item.id}
              </p>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    openSprite(item.image);
                    setScreen('editor');
                  }}
                >
                  {t('gallery.edit')}
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    toggleFavourite(item.id);
                  }}
                >
                  {item.favourite ? t('gallery.unfavourite') : t('gallery.favourite')}
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    remove(item.id);
                  }}
                >
                  {t('gallery.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
