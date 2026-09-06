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
 * Sprites generated during this session.
 *
 * The gallery is in memory only. Persisting it means writing files to disk,
 * which needs a location the user chose, and that decision is not made in this
 * scaffold.
 */

import { create } from 'zustand';

import type { SpriteImage } from '@/types/engine';

/** One sprite in the gallery. */
export interface GalleryItem {
  /** Stable identifier, used as the React key. */
  id: string;
  /** The sprite itself. */
  image: SpriteImage;
  /** The prompt that produced it. */
  prompt: string;
  /** When it was generated, as a millisecond timestamp. */
  createdAt: number;
  /** Whether the user marked it. */
  favourite: boolean;
}

/** Which items the gallery is showing. */
export type GalleryFilter = 'all' | 'favourites';

interface GalleryState {
  items: GalleryItem[];
  filter: GalleryFilter;

  /** Adds the sprites from one run, newest first. */
  add: (images: SpriteImage[], prompt: string) => void;
  /** Marks or unmarks an item. */
  toggleFavourite: (id: string) => void;
  /** Removes one item. */
  remove: (id: string) => void;
  /** Removes every item. */
  clear: () => void;
  /** Changes which items are shown. */
  setFilter: (filter: GalleryFilter) => void;
}

let sequence = 0;

/**
 * Returns an identifier that is unique within the session.
 *
 * A counter rather than a random value, so that a rendered gallery is stable
 * across a snapshot test run.
 *
 * @returns The next identifier.
 */
function nextId(): string {
  sequence += 1;
  return `sprite-${sequence}`;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  items: [],
  filter: 'all',

  add: (images, prompt) => {
    const created = images.map((image) => ({
      id: nextId(),
      image,
      prompt,
      createdAt: Date.now(),
      favourite: false,
    }));
    set({ items: [...created, ...get().items] });
  },

  toggleFavourite: (id) => {
    set({
      items: get().items.map((item) =>
        item.id === id ? { ...item, favourite: !item.favourite } : item,
      ),
    });
  },

  remove: (id) => {
    set({ items: get().items.filter((item) => item.id !== id) });
  },

  clear: () => {
    set({ items: [] });
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
