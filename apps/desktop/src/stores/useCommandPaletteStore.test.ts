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

/** Whether the command palette is showing. */

import { beforeEach, describe, expect, it } from 'vitest';

import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';

beforeEach(() => {
  useCommandPaletteStore.setState({ open: false });
});

describe('setOpen', () => {
  it('opens the palette', () => {
    useCommandPaletteStore.getState().setOpen(true);
    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it('closes the palette', () => {
    useCommandPaletteStore.setState({ open: true });
    useCommandPaletteStore.getState().setOpen(false);
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });
});

describe('toggle', () => {
  it('flips a closed palette open', () => {
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it('flips an open palette closed', () => {
    useCommandPaletteStore.setState({ open: true });
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });
});
