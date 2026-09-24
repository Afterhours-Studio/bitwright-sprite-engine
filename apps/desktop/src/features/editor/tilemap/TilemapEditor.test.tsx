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
 * The tilemap editor, against a mocked bridge.
 *
 * `tilemap.none` is the ordinary starting point for a background asset, so
 * the first thing exercised here is that it opens the create form rather than
 * showing an alert. With a map, the risk worth a test is the coordinate math:
 * that the cell clicked is the placement sent, on the layer that is actually
 * active, and that the eraser sends `null` rather than being just another
 * tile with no preview.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TilemapEditor } from '@/features/editor/tilemap/TilemapEditor';
import type { ShellResult } from '@/lib/tauri';
import type { TileAsset, Tilemap } from '@/types/tilemap';

vi.mock('@/lib/tilemap', () => ({
  onTilemapChanged: vi.fn(),
  tilemapAddLayer: vi.fn(),
  tilemapCreate: vi.fn(),
  tilemapPlace: vi.fn(),
  tilemapPreview: vi.fn(),
  tilemapRead: vi.fn(),
  tilemapRemoveLayer: vi.fn(),
  tilemapSetLayer: vi.fn(),
  tilemapTiles: vi.fn(),
}));

const lib = await import('@/lib/tilemap');

/** A 3x3 map with one empty `ground` layer. */
function map(): Tilemap {
  return {
    tileWidth: 16,
    tileHeight: 16,
    columns: 3,
    rows: 3,
    layers: [{ name: 'ground', parallax: 1, visible: true, tiles: new Array(9).fill(null) }],
  };
}

/** The one tile asset the mocked project offers. */
function tile(): TileAsset {
  return { id: 'tile-1', name: 'Grass', width: 16, height: 16, preview: 'data:image/png;grass' };
}

/** A second, distinct map, for the tests that switch which asset is shown. */
function otherMap(): Tilemap {
  return {
    tileWidth: 32,
    tileHeight: 32,
    columns: 2,
    rows: 2,
    layers: [{ name: 'sky', parallax: 0.5, visible: true, tiles: new Array(4).fill(null) }],
  };
}

/**
 * A promise a test can resolve on its own schedule, to model a read that is
 * still in flight when something else changes.
 *
 * @returns The promise, and the function that settles it.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.onTilemapChanged).mockResolvedValue(vi.fn());
  vi.mocked(lib.tilemapTiles).mockResolvedValue({ ok: true, value: [tile()] });
  vi.mocked(lib.tilemapPreview).mockResolvedValue({ ok: true, value: 'data:image/png;preview' });
});

describe('with no map yet', () => {
  beforeEach(() => {
    vi.mocked(lib.tilemapRead).mockResolvedValue({
      ok: false,
      error: { code: 'tilemap.none', detail: 'no map for this asset' },
    });
  });

  it('shows the create form', async () => {
    render(<TilemapEditor assetId="asset-1" />);

    expect(await screen.findByText('No tilemap yet')).toBeInTheDocument();
  });

  it('creates a map at the default size', async () => {
    vi.mocked(lib.tilemapCreate).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    await screen.findByText('No tilemap yet');

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(lib.tilemapCreate).toHaveBeenCalledWith('asset-1', 16, 16, 20, 12);
    });
  });
});

describe('with a map', () => {
  beforeEach(() => {
    vi.mocked(lib.tilemapRead).mockResolvedValue({ ok: true, value: map() });
  });

  it('renders columns times rows cells', async () => {
    render(<TilemapEditor assetId="asset-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Cell (2, 2)' })).toBeInTheDocument();
    // 9 cells, the eraser button, and the one tile in the picker; the cells
    // are what this test is about, counted precisely.
    const cells = ['0', '1', '2'].flatMap((y) =>
      ['0', '1', '2'].map((x) => screen.getByRole('button', { name: `Cell (${x}, ${y})` })),
    );
    expect(cells).toHaveLength(9);
  });

  it('places the selected tile on the active layer at the cell clicked', async () => {
    vi.mocked(lib.tilemapPlace).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Grass' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Grass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cell (1, 2)' }));

    await waitFor(() => {
      expect(lib.tilemapPlace).toHaveBeenCalledWith('asset-1', 'ground', [
        { x: 1, y: 2, tile: 'tile-1' },
      ]);
    });
  });

  it('places null with the eraser', async () => {
    vi.mocked(lib.tilemapPlace).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Grass' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Grass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cell (1, 2)' }));

    await waitFor(() => {
      expect(lib.tilemapPlace).toHaveBeenCalledWith('asset-1', 'ground', [
        { x: 1, y: 2, tile: null },
      ]);
    });
  });

  it('disables Remove with only one layer', async () => {
    render(<TilemapEditor assetId="asset-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('shows an alert when a placement is refused', async () => {
    vi.mocked(lib.tilemapPlace).mockResolvedValue({
      ok: false,
      error: { code: 'tilemap.layer_missing', detail: 'no such layer' },
    });

    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cell (0, 0)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred.');
  });

  it('marks the chosen tile as pressed, and no other', async () => {
    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Grass' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Grass' })).toHaveAttribute('aria-pressed', 'false');
    // The eraser is the default choice, so it starts pressed.
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Grass' }));

    expect(screen.getByRole('button', { name: 'Grass' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('asks for the preview again after a placement succeeds', async () => {
    vi.mocked(lib.tilemapPlace).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
    });
    // Once from the initial load.
    expect(lib.tilemapPreview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cell (0, 0)' }));

    await waitFor(() => {
      expect(lib.tilemapPreview).toHaveBeenCalledTimes(2);
    });
  });

  it('does not ask for the preview again when a placement is refused', async () => {
    vi.mocked(lib.tilemapPlace).mockResolvedValue({
      ok: false,
      error: { code: 'tilemap.layer_missing', detail: 'no such layer' },
    });

    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
    });
    expect(lib.tilemapPreview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cell (0, 0)' }));
    await screen.findByRole('alert');

    expect(lib.tilemapPreview).toHaveBeenCalledTimes(1);
  });

  it('reloads on a tilemap://changed event for this asset', async () => {
    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(lib.tilemapRead).toHaveBeenCalledTimes(1);
    });

    const handler = vi.mocked(lib.onTilemapChanged).mock.calls[0]?.[0];
    expect(handler).toBeDefined();

    await act(async () => {
      handler?.({ assetId: 'asset-1' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(lib.tilemapRead).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores a tilemap://changed event for a different asset', async () => {
    render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(lib.tilemapRead).toHaveBeenCalledTimes(1);
    });

    const handler = vi.mocked(lib.onTilemapChanged).mock.calls[0]?.[0];

    await act(async () => {
      handler?.({ assetId: 'asset-2' });
      await Promise.resolve();
    });

    expect(lib.tilemapRead).toHaveBeenCalledTimes(1);
  });

  it('commits a parallax value on blur', async () => {
    vi.mocked(lib.tilemapSetLayer).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    const input = await screen.findByRole('spinbutton', { name: 'Parallax for ground' });

    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(lib.tilemapSetLayer).toHaveBeenCalledWith('asset-1', 'ground', 2.5, undefined);
    });
  });

  it('commits a parallax value on Enter', async () => {
    vi.mocked(lib.tilemapSetLayer).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    const input = await screen.findByRole('spinbutton', { name: 'Parallax for ground' });

    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(lib.tilemapSetLayer).toHaveBeenCalledWith('asset-1', 'ground', 3, undefined);
    });
  });

  it('does not commit a blank parallax field', async () => {
    render(<TilemapEditor assetId="asset-1" />);
    const input = await screen.findByRole('spinbutton', { name: 'Parallax for ground' });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    // Nothing to await for: the assertion is that the write never happens.
    expect(lib.tilemapSetLayer).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range parallax and shows the committed value again', async () => {
    render(<TilemapEditor assetId="asset-1" />);
    const input = await screen.findByRole('spinbutton', { name: 'Parallax for ground' });

    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.blur(input);

    expect(lib.tilemapSetLayer).not.toHaveBeenCalled();
    // The layer's own parallax is 1: the rejected "9" must not be left
    // showing as though it had taken effect.
    await waitFor(() => {
      expect(input).toHaveValue(1);
    });
  });

  it('toggles a layer visible or hidden', async () => {
    vi.mocked(lib.tilemapSetLayer).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Show ground' });

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(lib.tilemapSetLayer).toHaveBeenCalledWith('asset-1', 'ground', undefined, false);
    });
  });

  it('adds a layer from the add-layer form', async () => {
    vi.mocked(lib.tilemapAddLayer).mockResolvedValue({ ok: true, value: map() });

    render(<TilemapEditor assetId="asset-1" />);
    await screen.findByRole('button', { name: 'Add layer' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'sky' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Parallax' }), {
      target: { value: '0.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add layer' }));

    await waitFor(() => {
      expect(lib.tilemapAddLayer).toHaveBeenCalledWith('asset-1', 'sky', 0.5);
    });
  });
});

describe('switching assets', () => {
  beforeEach(() => {
    vi.mocked(lib.tilemapRead).mockResolvedValue({ ok: true, value: map() });
  });

  it('drops a read for the asset shown before, once a newer one has started', async () => {
    const first = deferred<ShellResult<Tilemap>>();
    vi.mocked(lib.tilemapRead).mockReturnValueOnce(first.promise);

    const { rerender } = render(<TilemapEditor assetId="asset-1" />);

    vi.mocked(lib.tilemapRead).mockResolvedValue({ ok: true, value: otherMap() });
    rerender(<TilemapEditor assetId="asset-2" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
    });
    // asset-2's 2x2 map is on screen; asset-1's cells never appeared.
    expect(screen.queryByRole('button', { name: 'Cell (2, 2)' })).not.toBeInTheDocument();

    // The stale read for asset-1 finally answers. It must change nothing.
    await act(async () => {
      first.resolve({ ok: true, value: map() });
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: 'Cell (2, 2)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
  });

  it('drops a placement response for the asset shown before, once a newer asset is shown', async () => {
    const place = deferred<ShellResult<Tilemap>>();
    vi.mocked(lib.tilemapPlace).mockReturnValueOnce(place.promise);

    const { rerender } = render(<TilemapEditor assetId="asset-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (0, 0)' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cell (0, 0)' }));

    vi.mocked(lib.tilemapRead).mockResolvedValue({ ok: true, value: otherMap() });
    rerender(<TilemapEditor assetId="asset-2" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell (1, 1)' })).toBeInTheDocument();
    });
    // asset-2's map is 2x2; a cell that only exists in asset-1's 3x3 map
    // proves which one is actually on screen.
    expect(screen.queryByRole('button', { name: 'Cell (2, 2)' })).not.toBeInTheDocument();

    // The deferred placement for asset-1 finally answers, as a refusal. Sent
    // for an asset this panel has since moved on from, it must change
    // nothing: no alert, and asset-2's map stays exactly as it was.
    await act(async () => {
      place.resolve({
        ok: false,
        error: { code: 'tilemap.layer_missing', detail: 'no such layer' },
      });
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cell (2, 2)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cell (1, 1)' })).toBeInTheDocument();
  });
});
