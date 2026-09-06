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
 * Whether the command palette is showing.
 *
 * A store of its own, rather than a field on the shell store, because the
 * palette is opened from several unrelated places: the search button in the
 * title bar, a keyboard shortcut anywhere in the application, and eventually a
 * menu item. None of them should have to know where the others live.
 */

import { create } from 'zustand';

interface CommandPaletteState {
  /** Whether the palette is showing. */
  open: boolean;
  /** Shows or hides the palette. */
  setOpen: (open: boolean) => void;
  /** Flips the palette, which is what a shortcut key does. */
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  open: false,

  setOpen: (open) => {
    set({ open });
  },

  toggle: () => {
    set({ open: !get().open });
  },
}));
