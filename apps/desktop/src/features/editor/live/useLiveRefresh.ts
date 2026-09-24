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
 * Re-reads the layers a burst of writes touched, once per frame.
 *
 * WHY THE FRAME IS THE UNIT. `document://changed` names the roles that moved
 * and carries no pixels, so the answer to one event is one read per role. An
 * agent drawing fast emits several events per frame, and reading each one as it
 * arrives costs a command per event for pixels that were already stale by the
 * time the previous read answered. Collecting the roles until the browser is
 * about to paint turns a burst into one read per role per frame, which is the
 * whole reason the event carries roles instead of pixels.
 *
 * THE UNION IS WHAT IS READ. Two events naming the same role in one frame
 * collapse to one read of it, because the second write's pixels are the ones a
 * read would return anyway. The roles are handed over in the order they first
 * arrived, which is the order the writes happened in.
 *
 * THE CALLER'S FUNCTION IS NOT A DEPENDENCY. It is held in a ref, so a caller
 * that passes a closure written inline - the ordinary case - does not tear the
 * subscription down and rebuild it on every render, which would drop whatever
 * the current frame had collected. The subscription follows `assetId` alone,
 * because that is the only thing that changes which events are this window's.
 *
 * AN EVENT FOR ANOTHER ASSET IS NOT THIS WINDOW'S. An agent can write to any
 * asset it is pointed at, including one this window does not have open, and a
 * re-read of a role in the wrong document would show the wrong sprite.
 */

import { useEffect, useRef } from 'react';

import { onDocumentChanged } from '@/lib/mcp';

import type { LayerRole } from '@/types/document';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Subscribes to document writes and reports the roles they moved, coalesced to
 * one call per animation frame.
 *
 * @param assetId - The asset this window has open, or null when none is.
 * @param refresh - Called once per frame with the union of the roles that moved.
 */
export function useLiveRefresh(
  assetId: string | null,
  refresh: (roles: LayerRole[]) => void,
): void {
  const latestRefresh = useRef(refresh);

  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    let frame: number | null = null;
    const pending = new Set<LayerRole>();

    /** Hands the roles that arrived to the caller, once per frame. */
    const flush = (): void => {
      frame = null;
      if (pending.size === 0) {
        return;
      }
      const roles = [...pending];
      pending.clear();
      latestRefresh.current(roles);
    };

    void onDocumentChanged((event) => {
      if (cancelled || event.assetId !== assetId) {
        return;
      }
      for (const role of event.roles) {
        pending.add(role);
      }
      frame ??= requestAnimationFrame(flush);
    }).then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      // Whatever the frame had collected belongs to the document being left
      // behind, so it is dropped rather than read against the next one.
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      pending.clear();
    };
  }, [assetId]);
}
