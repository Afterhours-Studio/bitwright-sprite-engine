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
 * The sprites on disk.
 *
 * The gallery is a view of the sprites directory rather than a list held in
 * memory: anything else means a sprite exists in two places that disagree the
 * moment one changes, and it means closing the window loses the record of work
 * that is still sitting on disk.
 *
 * The favourite mark is the one thing here that is not on disk. It lasts for
 * the session and no longer, because marking one costs nothing and keeping it
 * would mean a second record beside the directory - which is the arrangement
 * the rest of this store exists to avoid.
 */

import { create } from 'zustand';

import { listSprites, removeSprite } from '@/lib/api';

import type { SpriteImage } from '@/types/engine';

/** One sprite in the gallery. */
export interface GalleryItem {
  /** The file name, which is both the identifier and the React key. */
  id: string;
  /** The sprite itself. */
  image: SpriteImage;
  /** When it was written, as a millisecond timestamp. */
  createdAt: number;
  /** Whether the user marked it. */
  favourite: boolean;
}

/** Which items the gallery is showing. */
export type GalleryFilter = 'all' | 'favourites';

interface GalleryState {
  items: GalleryItem[];
  filter: GalleryFilter;

  /** True while the directory is being read. */
  loading: boolean;
  /** Reads the sprites directory, replacing what is shown. */
  load: () => Promise<void>;
  /** Marks or unmarks an item. */
  toggleFavourite: (id: string) => void;
  /** Deletes one sprite, from the list and from disk. */
  remove: (id: string) => void;
  /** Changes which items are shown. */
  setFilter: (filter: GalleryFilter) => void;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  items: [],
  filter: 'all',
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const listed = await listSprites();
      // Replaced rather than merged. The directory is the record; a list this
      // store had built during the session would only differ from it by being
      // out of date, and keeping both means showing a sprite that was deleted
      // or missing one that was written.
      set({
        items: listed.sprites.map((sprite) => ({
          id: sprite.name,
          image: {
            data: sprite.data,
            width: sprite.width,
            height: sprite.height,
            path: sprite.path,
          },
          createdAt: sprite.modifiedAt * 1000,
          favourite: false,
        })),
      });
    } catch {
      // A gallery that cannot be read is empty rather than broken: the sprites
      // are on disk either way, and the next read will find them.
    } finally {
      set({ loading: false });
    }
  },

  toggleFavourite: (id) => {
    set({
      items: get().items.map((item) =>
        item.id === id ? { ...item, favourite: !item.favourite } : item,
      ),
    });
  },

  remove: (id) => {
    // The item's id is its file name, so removing it from the list and leaving
    // the file would show it again on the next read.
    void removeSprite(id).catch(() => undefined);
    set({ items: get().items.filter((item) => item.id !== id) });
  },

  setFilter: (filter) => {
    set({ filter });
  },
}));

/**
 * Applies a filter to the gallery.
 *
 * @param items - Every item in the gallery.
 * @param filter - Which items to show.
 * @returns The visible items.
 */
export function visibleItems(items: GalleryItem[], filter: GalleryFilter): GalleryItem[] {
  return filter === 'favourites' ? items.filter((item) => item.favourite) : items;
}
