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
 * Where the application's data is kept: the candidate proposed and confirmed,
 * what a refused proposal or apply leaves behind, and that apply never moves
 * anything on disk itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  getStorage,
  pickDirectory,
  resetStorageRoot,
  setStorageRoot,
  validateStorage,
} from '@/lib/api';
import { useStorageStore } from '@/stores/useStorageStore';
import type * as ApiModule from '@/lib/api';
import type { StorageChange, StorageInfo } from '@/types/engine';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('@/lib/api');
  return {
    ApiError: actual.ApiError,
    getStorage: vi.fn(),
    pickDirectory: vi.fn(),
    validateStorage: vi.fn(),
    setStorageRoot: vi.fn(),
    resetStorageRoot: vi.fn(),
  };
});

/**
 * A storage location, as the engine would report one.
 *
 * @param root - The path in use.
 * @param overrides - Fields to override.
 * @returns The info.
 */
function info(root: string, overrides: Partial<StorageInfo> = {}): StorageInfo {
  return {
    root,
    defaultRoot: 'C:/Users/dev/AppData/bitwright',
    isDefault: root === 'C:/Users/dev/AppData/bitwright',
    freeBytes: 1_000_000,
    totalBytes: 2_000_000,
    usedBytes: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getStorage).mockReset();
  vi.mocked(pickDirectory).mockReset();
  vi.mocked(validateStorage).mockReset();
  vi.mocked(setStorageRoot).mockReset();
  vi.mocked(resetStorageRoot).mockReset();
  useStorageStore.setState({
    info: null,
    candidate: null,
    leftBehind: null,
    loading: false,
    error: null,
  });
});

describe('refresh', () => {
  it('reads the location in use', async () => {
    vi.mocked(getStorage).mockResolvedValue(info('D:/sprites'));

    await useStorageStore.getState().refresh();

    const state = useStorageStore.getState();
    expect(state.info).toEqual(info('D:/sprites'));
    expect(state.loading).toBe(false);
  });

  it('records the reason code when the engine refuses', async () => {
    vi.mocked(getStorage).mockRejectedValue(new ApiError('storage.unreadable', 'nope'));

    await useStorageStore.getState().refresh();

    const state = useStorageStore.getState();
    expect(state.error).toBe('storage.unreadable');
    expect(state.loading).toBe(false);
  });
});

describe('browse', () => {
  it('does nothing when the dialog is closed without a choice', async () => {
    vi.mocked(pickDirectory).mockResolvedValue(null);

    await useStorageStore.getState().browse();

    const state = useStorageStore.getState();
    expect(state.candidate).toBeNull();
    expect(state.loading).toBe(false);
    expect(validateStorage).not.toHaveBeenCalled();
  });

  it('proposes the validated candidate that was chosen', async () => {
    vi.mocked(pickDirectory).mockResolvedValue('E:/sprites');
    vi.mocked(validateStorage).mockResolvedValue(info('E:/sprites'));

    await useStorageStore.getState().browse();

    expect(validateStorage).toHaveBeenCalledWith('E:/sprites');
    const state = useStorageStore.getState();
    expect(state.candidate).toEqual(info('E:/sprites'));
    expect(state.loading).toBe(false);
  });
});

describe('proposeDefault', () => {
  it('does nothing when the location has not been read yet', async () => {
    await useStorageStore.getState().proposeDefault();

    expect(validateStorage).not.toHaveBeenCalled();
    expect(useStorageStore.getState().candidate).toBeNull();
  });

  it('proposes the validated default location', async () => {
    useStorageStore.setState({ info: info('E:/sprites') });
    vi.mocked(validateStorage).mockResolvedValue(info('C:/Users/dev/AppData/bitwright'));

    await useStorageStore.getState().proposeDefault();

    expect(validateStorage).toHaveBeenCalledWith('C:/Users/dev/AppData/bitwright');
    expect(useStorageStore.getState().candidate).toEqual(info('C:/Users/dev/AppData/bitwright'));
  });
});

describe('clearCandidate', () => {
  it('drops the proposal', () => {
    useStorageStore.setState({ candidate: info('E:/sprites') });
    useStorageStore.getState().clearCandidate();
    expect(useStorageStore.getState().candidate).toBeNull();
  });
});

describe('apply', () => {
  it('does nothing when no candidate is proposed', async () => {
    await useStorageStore.getState().apply();
    expect(setStorageRoot).not.toHaveBeenCalled();
    expect(resetStorageRoot).not.toHaveBeenCalled();
  });

  it('sets the root for a custom candidate', async () => {
    useStorageStore.setState({ candidate: info('E:/sprites') });
    const change: StorageChange = {
      previous: info('D:/sprites', { usedBytes: 0 }),
      current: info('E:/sprites'),
      dataMoved: false,
    };
    vi.mocked(setStorageRoot).mockResolvedValue(change);

    await useStorageStore.getState().apply();

    expect(setStorageRoot).toHaveBeenCalledWith('E:/sprites');
    expect(resetStorageRoot).not.toHaveBeenCalled();
    const state = useStorageStore.getState();
    expect(state.info).toEqual(change.current);
    expect(state.candidate).toBeNull();
  });

  it('resets to the default root for a default candidate', async () => {
    useStorageStore.setState({ candidate: info('C:/Users/dev/AppData/bitwright') });
    const change: StorageChange = {
      previous: info('E:/sprites', { usedBytes: 0 }),
      current: info('C:/Users/dev/AppData/bitwright'),
      dataMoved: false,
    };
    vi.mocked(resetStorageRoot).mockResolvedValue(change);

    await useStorageStore.getState().apply();

    expect(resetStorageRoot).toHaveBeenCalled();
    expect(setStorageRoot).not.toHaveBeenCalled();
    expect(useStorageStore.getState().info).toEqual(change.current);
  });

  it('names the old location as left behind when it still held data', async () => {
    useStorageStore.setState({ candidate: info('E:/sprites') });
    const change: StorageChange = {
      previous: info('D:/sprites', { usedBytes: 4096 }),
      current: info('E:/sprites'),
      dataMoved: false,
    };
    vi.mocked(setStorageRoot).mockResolvedValue(change);

    await useStorageStore.getState().apply();

    expect(useStorageStore.getState().leftBehind).toBe('D:/sprites');
  });

  it('does not report a left-behind location when nothing moved', async () => {
    useStorageStore.setState({ candidate: info('D:/sprites') });
    const change: StorageChange = {
      previous: info('D:/sprites', { usedBytes: 4096 }),
      current: info('D:/sprites'),
      dataMoved: false,
    };
    vi.mocked(setStorageRoot).mockResolvedValue(change);

    await useStorageStore.getState().apply();

    expect(useStorageStore.getState().leftBehind).toBeNull();
  });

  it('records the failure and re-reads the location on a refused apply', async () => {
    useStorageStore.setState({ candidate: info('E:/sprites') });
    vi.mocked(setStorageRoot).mockRejectedValue(new ApiError('storage.write_failed', 'locked'));
    vi.mocked(getStorage).mockResolvedValue(info('D:/sprites'));

    await useStorageStore.getState().apply();

    const state = useStorageStore.getState();
    expect(state.error).toBe('storage.write_failed');
    expect(getStorage).toHaveBeenCalled();
    expect(state.info).toEqual(info('D:/sprites'));
  });
});

describe('clearError', () => {
  it('clears the last error', () => {
    useStorageStore.setState({ error: 'storage.unreadable' });
    useStorageStore.getState().clearError();
    expect(useStorageStore.getState().error).toBeNull();
  });
});
