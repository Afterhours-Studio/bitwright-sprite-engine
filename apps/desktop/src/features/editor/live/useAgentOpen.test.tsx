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

import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openRequestedAsset, useAgentOpen } from '@/features/editor/live/useAgentOpen';

import type { ReactElement } from 'react';

const mocks = vi.hoisted(() => ({
  onDocumentOpened: vi.fn(),
  projectState: vi.fn(),
  shellState: vi.fn(),
  assetOpen: vi.fn(),
  load: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  selectProject: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
  selectAsset: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
  setScreen: vi.fn(),
}));

vi.mock('@/lib/mcp', () => ({ onDocumentOpened: mocks.onDocumentOpened }));
vi.mock('@/lib/document', () => ({ assetOpen: mocks.assetOpen }));
vi.mock('@/stores/useProjectStore', () => ({
  useProjectStore: { getState: mocks.projectState },
}));
vi.mock('@/stores/useShellStore', () => ({
  useShellStore: { getState: mocks.shellState },
}));

/** The state the hook re-reads: only the two things it looks at. */
interface FakeState {
  projects: { id: string }[];
  assets: { id: string }[];
}

/**
 * Points the project store at a mutable state, so a `load` that changes the
 * projects is visible to the hook's next read.
 *
 * @param state - The state to hand out on every `getState`.
 * @returns The state object, so a test can change it later.
 */
function pointAtProjectStore(state: FakeState): FakeState {
  mocks.projectState.mockImplementation(() => ({
    ...state,
    load: mocks.load,
    selectProject: mocks.selectProject,
    selectAsset: mocks.selectAsset,
  }));
  return state;
}

/** Renders the hook so a test can watch it subscribe and unsubscribe. */
function Probe(): ReactElement {
  useAgentOpen();
  return <div />;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onDocumentOpened.mockResolvedValue(vi.fn());
  pointAtProjectStore({ projects: [], assets: [] });
  mocks.shellState.mockReturnValue({ setScreen: mocks.setScreen });
});

describe('openRequestedAsset', () => {
  it('opens an asset whose project is not in the store yet', async () => {
    const state = pointAtProjectStore({ projects: [], assets: [] });
    mocks.assetOpen.mockResolvedValue({
      ok: true,
      value: { asset: { id: 'a1', projectId: 'p2' } },
    });
    mocks.load.mockImplementation(() => {
      state.projects = [{ id: 'p2' }];
      return Promise.resolve();
    });

    await openRequestedAsset('a1');

    expect(mocks.assetOpen).toHaveBeenCalledWith('a1');
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.selectProject).toHaveBeenCalledWith('p2');
    expect(mocks.selectAsset).toHaveBeenCalledWith('a1');
    expect(mocks.setScreen).toHaveBeenCalledWith('editor');
  });

  it('warns and leaves the selected project unchanged for an unknown asset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pointAtProjectStore({ projects: [{ id: 'p1' }], assets: [] });
    mocks.assetOpen.mockResolvedValue({
      ok: false,
      error: { code: 'document.not_found', message: 'no such asset' },
    });

    await openRequestedAsset('gone');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.selectProject).not.toHaveBeenCalled();
    expect(mocks.selectAsset).not.toHaveBeenCalled();
    expect(mocks.setScreen).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});

describe('useAgentOpen', () => {
  it('follows the agent request and detaches on unmount', async () => {
    const state = pointAtProjectStore({ projects: [], assets: [] });
    mocks.assetOpen.mockResolvedValue({
      ok: true,
      value: { asset: { id: 'a1', projectId: 'p2' } },
    });
    mocks.load.mockImplementation(() => {
      state.projects = [{ id: 'p2' }];
      return Promise.resolve();
    });

    const detach = vi.fn();
    mocks.onDocumentOpened.mockResolvedValue(detach);

    const { unmount } = render(<Probe />);

    await waitFor(() => {
      expect(mocks.onDocumentOpened).toHaveBeenCalledTimes(1);
    });
    const handler = mocks.onDocumentOpened.mock.calls[0]?.[0] as (event: {
      assetId: string;
    }) => void;

    await act(async () => {
      handler({ assetId: 'a1' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.selectAsset).toHaveBeenCalledWith('a1');
    });
    expect(mocks.selectProject).toHaveBeenCalledWith('p2');
    expect(mocks.setScreen).toHaveBeenCalledWith('editor');

    unmount();

    expect(detach).toHaveBeenCalledTimes(1);
  });
});
