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
 * What the colour column does with a press.
 *
 * The failures worth catching are the ones that change the sprite: a palette
 * write that breaks the one-based, gap-free numbering Rust insists on, a
 * removal that would orphan painted pixels, and a pick that lands in the
 * wrong chip so the next stroke writes a slot nobody chose.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, invoke: vi.fn() };
});

const tauri = await import('@/lib/tauri');
import { toHex } from '@/features/editor/colour';
import { PalettePanel } from '@/features/editor/tools/PalettePanel';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { MAX_BRUSH_SIZE, useEditorStore } from '@/stores/useEditorStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Asset, Layer, Palette, Style } from '@/types/document';

/** Three slots: two in a ramp, one loose. */
const PALETTE: Palette = {
  slots: [
    { index: 1, rgba: [252, 211, 116, 255], name: null, ramp: 'skin', step: 0 },
    { index: 2, rgba: [200, 150, 90, 255], name: null, ramp: 'skin', step: 1 },
    { index: 3, rgba: [10, 20, 30, 255], name: null, ramp: null, step: null },
  ],
  ramps: [{ name: 'skin', material: 'skin', slots: [1, 2] }],
};

const ASSET: Asset = {
  id: 'asset-1',
  projectId: 'project-1',
  styleId: 'style-1',
  name: 'Hero',
  kind: 'character',
  width: 2,
  height: 2,
  step: 'flats',
  createdAt: 0,
  updatedAt: 0,
};

/**
 * A layer with the given pixels.
 *
 * @param data - Four slot indices.
 * @returns The layer.
 */
function layer(data: number[]): Layer {
  return {
    id: 'layer-1',
    role: 'flats',
    ordinal: 20,
    visible: true,
    locked: false,
    opacity: 1,
    buffer: { width: 2, height: 2, data },
  };
}

/** A write that stores what it was given, as the real one does on success. */
const writePalette = vi.fn(async (palette: Palette) => {
  await Promise.resolve();
  useDocumentStore.setState({ palette });
});

beforeEach(() => {
  writePalette.mockClear();
  vi.mocked(tauri.invoke).mockReset();
  vi.mocked(tauri.invoke).mockResolvedValue({ ok: false, error: { code: 'x', detail: '' } });
  useDocumentStore.setState({
    asset: null,
    palette: PALETTE,
    layers: [layer([0, 0, 0, 0])],
    error: null,
    writePalette,
  });
  useProjectStore.setState({ projects: [] });
  useEditorStore.setState({ slot: 1, secondarySlot: 2, brushSize: 1, brushShape: 'circle' });
});

describe('PalettePanel', () => {
  it('picks the primary with a left click and the secondary with a right click', () => {
    render(<PalettePanel />);

    const grid = screen.getByRole('group', { name: /Swatches/ });
    fireEvent.click(within(grid).getByRole('button', { name: 'Slot 3' }));
    expect(useEditorStore.getState().slot).toBe(3);

    fireEvent.contextMenu(within(grid).getByRole('button', { name: /Slot 1,/ }));
    expect(useEditorStore.getState().secondarySlot).toBe(1);
    expect(useEditorStore.getState().slot).toBe(3);
  });

  it('shows the primary slot as hex and number, and swaps the chips', () => {
    render(<PalettePanel />);

    expect(screen.getByTestId('slot-readout')).toHaveTextContent('fcd374 / 1');

    fireEvent.click(screen.getByRole('button', { name: /Swap primary and secondary/ }));

    expect(useEditorStore.getState().slot).toBe(2);
    expect(useEditorStore.getState().secondarySlot).toBe(1);
  });

  it('adds the next slot as a copy of the primary and picks it', async () => {
    render(<PalettePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Add color' }));

    await waitFor(() => {
      expect(useEditorStore.getState().slot).toBe(4);
    });
    const written = writePalette.mock.calls[0]?.[0];
    expect(written?.slots.map((slot) => slot.index)).toEqual([1, 2, 3, 4]);
    expect(written?.slots[3]?.rgba).toEqual([252, 211, 116, 255]);
    expect(screen.getByText('Colors in set (4)')).toBeInTheDocument();
  });

  it('removes the last slot and takes it out of its ramp', async () => {
    useDocumentStore.setState({
      palette: {
        slots: [PALETTE.slots[0], { ...PALETTE.slots[1] }] as Palette['slots'],
        ramps: PALETTE.ramps,
      },
    });
    useEditorStore.setState({ slot: 2, secondarySlot: 1 });
    render(<PalettePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove color' }));

    await waitFor(() => {
      expect(writePalette).toHaveBeenCalledOnce();
    });
    const written = writePalette.mock.calls[0]?.[0];
    expect(written?.slots.map((slot) => slot.index)).toEqual([1]);
    expect(written?.ramps[0]?.slots).toEqual([1]);
    // The primary pointed at the slot that went, so it moves to the one below.
    await waitFor(() => {
      expect(useEditorStore.getState().slot).toBe(1);
    });
  });

  it('keeps a slot that pixels still use, and says so', () => {
    useDocumentStore.setState({ layers: [layer([3, 3, 0, 1])] });
    render(<PalettePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove color' }));

    expect(writePalette).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Slot 3 is painted on 2 pixels');
  });

  it('stops adding at the style ceiling', async () => {
    const style = { id: 'style-1', preset: 'snes', rules: { maxSlots: 3 } } as unknown as Style;
    vi.mocked(tauri.invoke).mockImplementation(async (command) => {
      await Promise.resolve();
      return command === 'style_read'
        ? { ok: true, value: style }
        : { ok: false, error: { code: 'x', detail: '' } };
    });
    useDocumentStore.setState({ asset: ASSET });
    render(<PalettePanel />);

    expect(await screen.findByText('SNES')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add color' })).toBeDisabled();
  });

  it('sets the brush from the cards and the stepper, up to the ceiling', () => {
    render(<PalettePanel />);

    fireEvent.click(screen.getByRole('button', { name: '3 px brush' }));
    expect(useEditorStore.getState().brushSize).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Larger brush' }));
    expect(useEditorStore.getState().brushSize).toBe(4);

    fireEvent.click(screen.getByRole('button', { name: 'Square' }));
    expect(useEditorStore.getState().brushShape).toBe('square');

    useEditorStore.setState({ brushSize: MAX_BRUSH_SIZE });
    render(<PalettePanel />);
    expect(screen.getAllByRole('button', { name: 'Larger brush' }).at(-1)).toBeDisabled();
  });

  it('edits the primary slot colour from the Ramps tab', () => {
    render(<PalettePanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Ramps' }));
    expect(screen.getByText('In no ramp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change colour' }));
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: toHex([0, 0, 0, 255]) } });

    const written = writePalette.mock.calls[0]?.[0];
    expect(written?.slots[0]?.rgba).toEqual([0, 0, 0, 255]);
    expect(written?.slots).toHaveLength(3);
  });
});
