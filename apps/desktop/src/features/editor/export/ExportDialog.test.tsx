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
 * The export dialog, exercised against a mocked `lib/export` bridge and a
 * mocked directory picker.
 *
 * `localStorage` is cleared before each test: the dialog reads its remembered
 * folder, scale and pattern from it on mount, and a value left over from an
 * earlier test would make these tests order-dependent.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportDialog } from '@/features/editor/export/ExportDialog';
import type * as AnimationModule from '@/lib/animation';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Animation } from '@/types/animation';
import type { Asset, Project } from '@/types/document';
import type { ExportResult } from '@/types/export';

vi.mock('@/lib/export', () => ({ exportPng: vi.fn(), exportSheet: vi.fn() }));
vi.mock('@/lib/api', () => ({ pickDirectory: vi.fn() }));
vi.mock('@/lib/animation', async (original) => ({
  ...(await original<typeof AnimationModule>()),
  exportGif: vi.fn(),
}));

const exportLib = await import('@/lib/export');
const api = await import('@/lib/api');
const animationLib = await import('@/lib/animation');

/** Wraps a resolved value as an ok {@link ShellResult}. */
function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Wraps a code as an error {@link ShellResult}. */
function err(code: string): { ok: false; error: { code: string; detail: string } } {
  return { ok: false, error: { code, detail: code } };
}

/** A result as the shell would return one. */
function result(): ExportResult {
  return { path: 'D:/exports/hero@1x.png', width: 32, height: 32 };
}

/**
 * An animation of `count` frames, rooted at `asset-1`.
 *
 * @param count - How many frames.
 * @returns The animation.
 */
function walk(count: number): Animation {
  return {
    rootId: 'asset-1',
    playback: 'forward',
    frames: Array.from({ length: count }, (_, index) => ({
      assetId: index === 0 ? 'asset-1' : `frame-${String(index)}`,
      position: index,
      durationMs: 125,
      name: index === 0 ? 'walk' : `walk ${String(index + 1)}`,
      step: 'flats' as const,
      updatedAt: 1,
    })),
  };
}

const ROOT: Asset = {
  id: 'asset-1',
  projectId: 'project-1',
  styleId: null,
  name: 'walk',
  kind: 'character',
  width: 32,
  height: 32,
  step: 'flats',
  createdAt: 1,
  updatedAt: 1,
  rootId: null,
  frames: 3,
};

const FOREST: Project = {
  id: 'project-1',
  name: 'forest',
  styleId: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(exportLib.exportPng).mockReset();
  vi.mocked(exportLib.exportSheet).mockReset();
  vi.mocked(animationLib.exportGif).mockReset();
  vi.mocked(api.pickDirectory).mockReset();
  useAnimationStore.setState({ animation: null });
  useProjectStore.setState({ projects: [FOREST], allAssets: [ROOT], assets: [ROOT] });
});

/** Renders the dialog for `asset-1` and picks `D:/exports`. */
async function openWithFolder(): Promise<void> {
  vi.mocked(api.pickDirectory).mockResolvedValue('D:/exports');
  render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
  await screen.findByDisplayValue('D:/exports');
}

describe('ExportDialog', () => {
  it('disables the confirm while no folder has been chosen', () => {
    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('enables the confirm once a folder is chosen', async () => {
    vi.mocked(api.pickDirectory).mockResolvedValue('D:/exports');

    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(await screen.findByRole('button', { name: 'Export' })).toBeEnabled();
    expect(screen.getByDisplayValue('D:/exports')).toBeInTheDocument();
  });

  it('keeps the previous folder when the picker is cancelled', async () => {
    vi.mocked(api.pickDirectory).mockResolvedValueOnce('D:/exports').mockResolvedValueOnce(null);

    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByDisplayValue('D:/exports');

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(await screen.findByDisplayValue('D:/exports')).toBeInTheDocument();
  });

  it('exports with the chosen folder, scale, pattern and overwrite flag', async () => {
    vi.mocked(api.pickDirectory).mockResolvedValue('D:/exports');
    vi.mocked(exportLib.exportPng).mockResolvedValue(ok(result()));

    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByDisplayValue('D:/exports');

    fireEvent.change(screen.getByLabelText('File name pattern'), {
      target: { value: '{asset}-{kind}' },
    });
    fireEvent.click(screen.getByLabelText('Overwrite existing file'));

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(exportLib.exportPng).toHaveBeenCalledWith(
      'asset-1',
      'D:/exports',
      1,
      '{asset}-{kind}',
      true,
    );
  });

  it('shows the written path and size on success', async () => {
    vi.mocked(api.pickDirectory).mockResolvedValue('D:/exports');
    vi.mocked(exportLib.exportPng).mockResolvedValue(ok(result()));

    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByDisplayValue('D:/exports');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Wrote D:/exports/hero@1x.png (32 × 32)')).toBeInTheDocument();
  });

  it('shows the overwrite hint alongside the translated error for export.exists', async () => {
    vi.mocked(api.pickDirectory).mockResolvedValue('D:/exports');
    vi.mocked(exportLib.exportPng).mockResolvedValue(err('export.exists'));

    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByDisplayValue('D:/exports');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tick "Overwrite existing file" to replace it.')).toBeInTheDocument();
  });
});

describe('ExportDialog for an animation', () => {
  it('offers no output choice for a lone sprite', () => {
    useAnimationStore.setState({ animation: walk(1) });
    render(<ExportDialog assetId="asset-1" open onClose={vi.fn()} />);
    expect(screen.queryByRole('tab', { name: 'Animation (GIF)' })).not.toBeInTheDocument();
  });

  it('still exports this frame as a PNG by default', async () => {
    useAnimationStore.setState({ animation: walk(3) });
    vi.mocked(exportLib.exportPng).mockResolvedValue(ok(result()));
    await openWithFolder();

    expect(screen.getByRole('tab', { name: 'This frame (PNG)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(exportLib.exportPng).toHaveBeenCalledWith(
      'asset-1',
      'D:/exports',
      1,
      '{asset}@{scale}x',
      false,
    );
    expect(animationLib.exportGif).not.toHaveBeenCalled();
  });

  it('exports a GIF named from the pattern and the root, at the chosen scale', async () => {
    window.localStorage.setItem('bitwright.export', JSON.stringify({ scale: 2 }));
    useAnimationStore.setState({ animation: walk(3) });
    vi.mocked(animationLib.exportGif).mockResolvedValue(
      ok({ path: 'D:/exports/walk@2x.gif', width: 64, height: 64 }),
    );
    await openWithFolder();

    fireEvent.click(screen.getByRole('tab', { name: 'Animation (GIF)' }));
    expect(
      screen.getByText(/playback and frame durations set on the timeline/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Overwrite existing file')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(animationLib.exportGif).toHaveBeenCalledWith('asset-1', 2, 'D:/exports/walk@2x.gif');
    expect(exportLib.exportPng).not.toHaveBeenCalled();
    expect(
      await screen.findByText('Wrote D:/exports/walk@2x.gif (64 × 64, 3 frames)'),
    ).toBeInTheDocument();
  });

  it('exports a sheet of every frame in order, one row by default', async () => {
    useAnimationStore.setState({ animation: walk(3) });
    vi.mocked(exportLib.exportSheet).mockResolvedValue(ok(result()));
    await openWithFolder();

    fireEvent.click(screen.getByRole('tab', { name: 'Sprite sheet' }));
    expect(screen.getByLabelText('Columns')).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(exportLib.exportSheet).toHaveBeenCalledWith(
      ['asset-1', 'frame-1', 'frame-2'],
      'D:/exports',
      3,
      1,
      'walk@1x',
      false,
    );
  });

  it('uses the columns that were set for the sheet', async () => {
    useAnimationStore.setState({ animation: walk(4) });
    vi.mocked(exportLib.exportSheet).mockResolvedValue(ok(result()));
    await openWithFolder();

    fireEvent.click(screen.getByRole('tab', { name: 'Sprite sheet' }));
    const field = screen.getByLabelText('Columns');
    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(vi.mocked(exportLib.exportSheet).mock.calls[0]?.[2]).toBe(2);
  });
});
