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
 * The export bridge says the names the shell expects.
 *
 * There is no implementation here to exercise: every function is one call
 * that names a command and its argument keys. That indirection is the whole
 * risk, because a command name or an argument key that does not match the
 * Rust side is not a compile error on either side - it answers `invalid args`
 * at run time. So these tests assert the literal strings on the wire rather
 * than behaviour, which is the only cheap way to catch a rename made on one
 * side of the boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportDirectory, exportPng, exportSheet } from '@/lib/export';
import type { ExportResult } from '@/types/export';

vi.mock('@/lib/tauri', () => ({ invoke: vi.fn() }));

const tauri = await import('@/lib/tauri');

/** A result as the shell would return one. */
function result(): ExportResult {
  return { path: 'D:/exports/hero@2x.png', width: 64, height: 64 };
}

/**
 * Makes the next command answer with a value.
 *
 * @param value - What the command returns.
 */
function answersWith(value: unknown): void {
  vi.mocked(tauri.invoke).mockResolvedValue({ ok: true, value } as never);
}

beforeEach(() => {
  vi.mocked(tauri.invoke).mockReset();
});

describe('exportPng', () => {
  it('calls export_png with the asset, folder, scale, pattern and overwrite flag', async () => {
    answersWith(result());

    await expect(exportPng('asset-1', 'D:/exports', 2, '{asset}@{scale}x', false)).resolves.toEqual(
      { ok: true, value: result() },
    );
    expect(tauri.invoke).toHaveBeenCalledWith('export_png', {
      assetId: 'asset-1',
      directory: 'D:/exports',
      scale: 2,
      pattern: '{asset}@{scale}x',
      overwrite: false,
    });
  });

  it('sends overwrite through as given, rather than dropping it', async () => {
    answersWith(result());

    await exportPng('asset-1', 'D:/exports', 1, '{asset}@{scale}x', true);
    expect(tauri.invoke).toHaveBeenCalledWith(
      'export_png',
      expect.objectContaining({ overwrite: true }),
    );
  });
});

describe('exportSheet', () => {
  it('calls export_sheet with the asset list, columns, scale, name and overwrite flag', async () => {
    answersWith(result());

    await expect(
      exportSheet(['asset-1', 'asset-2'], 'D:/exports', 4, 1, 'sheet.png', false),
    ).resolves.toEqual({ ok: true, value: result() });
    expect(tauri.invoke).toHaveBeenCalledWith('export_sheet', {
      assetIds: ['asset-1', 'asset-2'],
      directory: 'D:/exports',
      columns: 4,
      scale: 1,
      name: 'sheet.png',
      overwrite: false,
    });
  });
});

describe('exportDirectory', () => {
  it('calls export_directory with no arguments', async () => {
    answersWith('D:/data/exports/my-project');

    await expect(exportDirectory()).resolves.toEqual({
      ok: true,
      value: 'D:/data/exports/my-project',
    });
    expect(tauri.invoke).toHaveBeenCalledWith('export_directory');
  });
});
