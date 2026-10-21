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
 * PNG to Pixel runs a short chain: pick, measure, create, import, convert.
 * What matters is the order, the size the sprite is created at, and that a
 * failure at each link either leaves nothing behind or keeps what exists.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nameFromPath, pngToPixel } from '@/features/home/pngToPixel';
import { useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import type { Asset } from '@/types/document';

vi.mock('@/lib/reference', () => ({
  referencePickFile: vi.fn(),
  referencePixelizeProbe: vi.fn(),
  referenceImport: vi.fn(),
  referencePixelize: vi.fn(),
}));

const reference = await import('@/lib/reference');

const STYLE = { era: '32bit', view: 'topdown' } as const;
const ASSET = { id: 'asset-1' } as unknown as Asset;
const PROBE = { canvasWidth: 20, canvasHeight: 24, width: 20, height: 24, cell: 7.5, colours: 5 };

const createAssetIn = vi.fn();
const notify = vi.fn();

/** An error result the way the shell reports one. */
function refused(code: string): never {
  return { ok: false, error: { code, message: code } } as never;
}

/** A success result. */
function succeeded(value: unknown): never {
  return { ok: true, value } as never;
}

beforeEach(() => {
  vi.mocked(reference.referencePickFile).mockReset();
  vi.mocked(reference.referencePixelizeProbe).mockReset();
  vi.mocked(reference.referenceImport).mockReset();
  vi.mocked(reference.referencePixelize).mockReset();
  createAssetIn.mockReset().mockResolvedValue(ASSET);
  notify.mockReset();
  useProjectStore.setState({ createAssetIn } as never);
  useToastStore.setState({ notify } as never);

  vi.mocked(reference.referencePickFile).mockResolvedValue(succeeded('D:/art/Hero Pose.png'));
  vi.mocked(reference.referencePixelizeProbe).mockResolvedValue(succeeded(PROBE));
  vi.mocked(reference.referenceImport).mockResolvedValue(succeeded({ id: 'ref-1' }));
  vi.mocked(reference.referencePixelize).mockResolvedValue(succeeded({}));
});

describe('nameFromPath', () => {
  it('drops the folder and the extension', () => {
    expect(nameFromPath('D:\\art\\hero.png')).toBe('hero');
    expect(nameFromPath('/tmp/a.b.png')).toBe('a.b');
  });
});

describe('pngToPixel', () => {
  it('creates the sprite at the detected size, imports, then pixelizes into it', async () => {
    const asset = await pngToPixel('project-1', STYLE);

    expect(asset).toBe(ASSET);
    expect(createAssetIn).toHaveBeenCalledWith('project-1', 'Hero Pose', 'character', 20, 24);
    expect(reference.referenceImport).toHaveBeenCalledWith('asset-1', 'D:/art/Hero Pose.png');
    expect(reference.referencePixelize).toHaveBeenCalledWith('asset-1', 'ref-1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing when the picker is cancelled', async () => {
    vi.mocked(reference.referencePickFile).mockResolvedValue(succeeded(null));

    expect(await pngToPixel('project-1', STYLE)).toBeNull();
    expect(reference.referencePixelizeProbe).not.toHaveBeenCalled();
    expect(createAssetIn).not.toHaveBeenCalled();
  });

  it('creates nothing and says so when the picture cannot be measured', async () => {
    vi.mocked(reference.referencePixelizeProbe).mockResolvedValue(refused('pixelize.empty'));

    expect(await pngToPixel('project-1', STYLE)).toBeNull();
    expect(createAssetIn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', titleKey: 'home:png.failedTitle' }),
    );
  });

  it('falls back to the character canvas of the style for a file that is not a PNG', async () => {
    vi.mocked(reference.referencePixelizeProbe).mockResolvedValue(refused('png.invalid'));

    await pngToPixel('project-1', STYLE);

    expect(createAssetIn).toHaveBeenCalledWith('project-1', 'Hero Pose', 'character', 48, 64);
    expect(reference.referencePixelize).toHaveBeenCalled();
  });

  it('keeps the sprite when the import fails, and does not convert', async () => {
    vi.mocked(reference.referenceImport).mockResolvedValue(refused('engine.unavailable'));

    expect(await pngToPixel('project-1', STYLE)).toBe(ASSET);
    expect(reference.referencePixelize).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'home:png.importFailed' }),
    );
  });

  it('keeps the sprite and its reference when the conversion fails', async () => {
    vi.mocked(reference.referencePixelize).mockResolvedValue(refused('pixelize.empty'));

    expect(await pngToPixel('project-1', STYLE)).toBe(ASSET);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', titleKey: 'home:png.failedTitle' }),
    );
  });
});
