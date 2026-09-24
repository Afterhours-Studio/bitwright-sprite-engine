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
 * The coalesced document refresh.
 *
 * `@/lib/mcp` is replaced whole and `requestAnimationFrame` is stubbed, so a
 * test drives the frame itself rather than waiting on a real one. That is what
 * makes the burst case - three events, one frame, one call - a deterministic
 * assertion instead of a race against the browser's own scheduling.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp', () => ({
  onDocumentChanged: vi.fn(),
}));

const mcp = await import('@/lib/mcp');
import { useLiveRefresh } from '@/features/editor/live/useLiveRefresh';
import type { LayerRole } from '@/types/document';
import type { DocumentChangedEvent } from '@/types/mcp';

/** Handlers captured from the hook's subscription. */
let handlers: ((event: DocumentChangedEvent) => void)[] = [];

/** Frames that have been scheduled and not yet run, oldest first. */
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  handlers = [];
  frames = [];
  vi.mocked(mcp.onDocumentChanged).mockReset();
  vi.mocked(mcp.onDocumentChanged).mockImplementation((handler) => {
    handlers.push(handler);
    return Promise.resolve(vi.fn());
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    frames[handle - 1] = () => undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Runs something that changes the hook's state, and lets the microtask queue
 * empty so a subscription that resolved during it is attached.
 *
 * @param change - The event to deliver, or the frame to run.
 */
async function settle(change: () => void): Promise<void> {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}

/**
 * Reports a write the shell would have emitted.
 *
 * @param event - What changed.
 */
async function changed(event: DocumentChangedEvent): Promise<void> {
  await settle(() => {
    for (const handler of handlers) {
      handler(event);
    }
  });
}

/** Runs every frame that is currently scheduled. */
async function paint(): Promise<void> {
  const due = frames;
  frames = [];
  await settle(() => {
    for (const frame of due) {
      frame(0);
    }
  });
}

describe('useLiveRefresh', () => {
  it('merges three events in one frame into one call with the union of roles', async () => {
    const refresh = vi.fn<(roles: LayerRole[]) => void>();
    renderHook(() => {
      useLiveRefresh('asset-1', refresh);
    });

    await changed({ assetId: 'asset-1', roles: ['silhouette'], seq: 1 });
    await changed({ assetId: 'asset-1', roles: ['flats', 'silhouette'], seq: 2 });
    await changed({ assetId: 'asset-1', roles: ['light'], seq: 3 });

    // Nothing is read before the frame, and three events are three events.
    expect(refresh).not.toHaveBeenCalled();

    await paint();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(['silhouette', 'flats', 'light']);
  });

  it('reports each frame separately rather than banking the burst', async () => {
    const refresh = vi.fn<(roles: LayerRole[]) => void>();
    renderHook(() => {
      useLiveRefresh('asset-1', refresh);
    });

    await changed({ assetId: 'asset-1', roles: ['silhouette'], seq: 1 });
    await paint();
    await changed({ assetId: 'asset-1', roles: ['flats'], seq: 2 });
    await paint();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenNthCalledWith(1, ['silhouette']);
    expect(refresh).toHaveBeenNthCalledWith(2, ['flats']);
  });

  it('ignores writes to another asset', async () => {
    const refresh = vi.fn<(roles: LayerRole[]) => void>();
    renderHook(() => {
      useLiveRefresh('asset-1', refresh);
    });

    await changed({ assetId: 'asset-2', roles: ['silhouette'], seq: 1 });
    await paint();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('says nothing while no document is open', async () => {
    const refresh = vi.fn<(roles: LayerRole[]) => void>();
    renderHook(() => {
      useLiveRefresh(null, refresh);
    });

    await changed({ assetId: 'asset-1', roles: ['silhouette'], seq: 1 });
    await paint();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops after unmount', async () => {
    const stop = vi.fn();
    vi.mocked(mcp.onDocumentChanged).mockImplementation((handler) => {
      handlers.push(handler);
      return Promise.resolve(stop);
    });
    const refresh = vi.fn<(roles: LayerRole[]) => void>();

    const { unmount } = renderHook(() => {
      useLiveRefresh('asset-1', refresh);
    });

    await settle(() => undefined);

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);

    await changed({ assetId: 'asset-1', roles: ['silhouette'], seq: 1 });
    await paint();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops what the old document had collected when the asset changes', async () => {
    const refresh = vi.fn<(roles: LayerRole[]) => void>();
    const initial: { assetId: string | null } = { assetId: 'asset-1' };
    const { rerender } = renderHook(
      ({ assetId }: { assetId: string | null }) => {
        useLiveRefresh(assetId, refresh);
      },
      { initialProps: initial },
    );

    await changed({ assetId: 'asset-1', roles: ['silhouette'], seq: 1 });
    rerender({ assetId: 'asset-2' });
    await paint();

    // The roles belonged to the document that was left behind; reading them
    // against the next one would show the wrong sprite.
    expect(refresh).not.toHaveBeenCalled();

    await changed({ assetId: 'asset-2', roles: ['flats'], seq: 2 });
    await paint();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(['flats']);
  });

  it('calls the newest callback without resubscribing', async () => {
    const first = vi.fn<(roles: LayerRole[]) => void>();
    const second = vi.fn<(roles: LayerRole[]) => void>();
    const { rerender } = renderHook(
      ({ refresh }: { refresh: (roles: LayerRole[]) => void }) => {
        useLiveRefresh('asset-1', refresh);
      },
      { initialProps: { refresh: first } },
    );

    rerender({ refresh: second });
    await changed({ assetId: 'asset-1', roles: ['silhouette'], seq: 1 });
    await paint();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(['silhouette']);
    // One subscription for the life of the mount: the hook follows the open
    // document, not the identity of a callback a caller writes inline.
    expect(handlers).toHaveLength(1);
  });
});
