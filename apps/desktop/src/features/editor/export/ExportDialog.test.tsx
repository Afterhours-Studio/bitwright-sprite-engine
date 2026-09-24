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
import type { ExportResult } from '@/types/export';

vi.mock('@/lib/export', () => ({ exportPng: vi.fn() }));
vi.mock('@/lib/api', () => ({ pickDirectory: vi.fn() }));

const exportLib = await import('@/lib/export');
const api = await import('@/lib/api');

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

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(exportLib.exportPng).mockReset();
  vi.mocked(api.pickDirectory).mockReset();
});

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
