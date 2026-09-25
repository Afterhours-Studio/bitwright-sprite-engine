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
 * The command palette's bottom panel and animation rows, against real stores
 * whose animation actions are replaced with spies.
 *
 * The bridge is mocked so nothing reaches a shell; what is pinned down is
 * which rows are offered, what each says it will do, and what choosing it asks
 * the stores for.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Tauri from '@/lib/tauri';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof Tauri>()),
  invoke: vi.fn(() => new Promise(() => undefined)),
}));

import { CommandPalette } from '@/components/ui/CommandPalette';
import { resources } from '@/lib/i18n';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useShellStore } from '@/stores/useShellStore';
import type { Animation } from '@/types/animation';

const en = resources.en.common.palette;

const play = vi.fn();
const pause = vi.fn();
const toggleOnionSkin = vi.fn();
const add = vi.fn(() => Promise.resolve());
const select = vi.fn(() => Promise.resolve());

/**
 * An animation of the given frames, the open one being `asset-1`.
 *
 * @param ids - The frames in order.
 * @returns The animation.
 */
function animationOf(ids: string[]): Animation {
  return {
    rootId: ids[0] ?? 'asset-1',
    playback: 'forward',
    frames: ids.map((assetId, position) => ({
      assetId,
      position,
      durationMs: 125,
      name: 'Knight',
      step: 'flats',
      updatedAt: 0,
    })),
  };
}

/**
 * Opens the palette and chooses a row by its label.
 *
 * @param label - The row's label, or a pattern for a row whose name also
 *   carries its shortcut key.
 */
function choose(label: string | RegExp): void {
  act(() => {
    useCommandPaletteStore.getState().setOpen(true);
  });
  const dialog = within(screen.getByRole('dialog', { name: en.label }));
  fireEvent.click(dialog.getByRole('option', { name: label }));
}

/**
 * Whether the open palette offers a row.
 *
 * @param label - The row's label.
 * @returns True when it is listed.
 */
function offers(label: string | RegExp): boolean {
  act(() => {
    useCommandPaletteStore.getState().setOpen(true);
  });
  const dialog = within(screen.getByRole('dialog', { name: en.label }));
  return dialog.queryByRole('option', { name: label }) !== null;
}

beforeEach(() => {
  for (const spy of [play, pause, toggleOnionSkin, add, select]) {
    spy.mockClear();
  }
  useShellStore.setState({ screen: 'editor' });
  useCommandPaletteStore.setState({ open: false });
  useDocumentStore.setState({ assetId: 'asset-1' });
  useEditorStore.setState({ bottomPanel: 'steps' });
  useAnimationStore.setState({
    animation: animationOf(['asset-0', 'asset-1', 'asset-2']),
    playing: false,
    onionSkin: false,
    play,
    pause,
    toggleOnionSkin,
    add,
    select,
  });
});

describe('CommandPalette bottom panel rows', () => {
  it('shows the timeline in the steps strip place, and hides the one showing', () => {
    render(<CommandPalette />);

    choose(en.showTimeline);
    expect(useEditorStore.getState().bottomPanel).toBe('timeline');

    choose(en.hideTimeline);
    expect(useEditorStore.getState().bottomPanel).toBeNull();

    choose(en.showStepsStrip);
    expect(useEditorStore.getState().bottomPanel).toBe('steps');

    choose(en.hideStepsStrip);
    expect(useEditorStore.getState().bottomPanel).toBeNull();
  });
});

describe('CommandPalette animation rows', () => {
  it('plays and pauses, saying which it will do', () => {
    render(<CommandPalette />);

    choose(en.play);
    expect(play).toHaveBeenCalledTimes(1);

    act(() => {
      useAnimationStore.setState({ playing: true });
    });
    choose(en.pause);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('toggles the onion skin and adds a copy of the open frame', () => {
    render(<CommandPalette />);

    choose(en.showOnionSkin);
    expect(toggleOnionSkin).toHaveBeenCalledTimes(1);
    act(() => {
      useAnimationStore.setState({ onionSkin: true });
    });
    expect(offers(en.hideOnionSkin)).toBe(true);

    choose(en.addFrame);
    expect(add).toHaveBeenCalledWith(true);
  });

  it('steps to the next and the previous frame', () => {
    render(<CommandPalette />);

    choose(new RegExp(`^${en.nextFrame}`));
    expect(select).toHaveBeenLastCalledWith('asset-2');
    choose(new RegExp(`^${en.previousFrame}`));
    expect(select).toHaveBeenLastCalledWith('asset-0');
  });

  it('offers no playing or stepping for a lone sprite, and no animation rows outside the editor', () => {
    useAnimationStore.setState({ animation: animationOf(['asset-1']) });
    render(<CommandPalette />);

    expect(offers(en.play)).toBe(false);
    expect(offers(new RegExp(`^${en.nextFrame}`))).toBe(false);
    expect(offers(en.addFrame)).toBe(true);

    act(() => {
      useShellStore.setState({ screen: 'home' });
    });
    expect(offers(en.addFrame)).toBe(false);
    expect(offers(en.showTimeline)).toBe(false);
  });
});
