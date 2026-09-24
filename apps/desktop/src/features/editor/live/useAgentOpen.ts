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
 * Follows the agent's `open_asset` tool call.
 *
 * When an agent asks for an asset to be brought up, the shell cannot do it on
 * its own: the project the asset belongs to may not be the one the window is
 * showing, and a document can only be opened for a project that has been
 * selected, because that is what puts its assets in the tree. So the request is
 * resolved here, where both stores are reachable.
 *
 * The subscription lives in the root component rather than in the editor,
 * because the asset has to be brought up whether or not the editor happens to
 * be the screen on screen when the call arrives.
 */

import { useEffect } from 'react';

import { assetOpen } from '@/lib/document';
import { onDocumentOpened } from '@/lib/mcp';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';

import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Brings one asset up: opens it, selects the project that owns it, and shows
 * the editor.
 *
 * The owning project is read straight from the document the shell returns,
 * rather than guessed by walking the project list. That matters because the
 * agent's normal sequence is `create_project`, `create_asset`, `open_asset`:
 * the project may have been created after the window loaded, so it is not in
 * the store yet, and the asset cannot be found by looking at what is loaded.
 * Opening the document first also means a request for an asset that no longer
 * exists fails without touching the user's selection.
 *
 * @param assetId - The asset the agent asked for.
 */
export async function openRequestedAsset(assetId: string): Promise<void> {
  const result = await assetOpen(assetId);

  if (!result.ok) {
    // A stale request - the agent could have read the id before something was
    // deleted - so it is reported and otherwise ignored, rather than leaving
    // the window on a project that cannot show what was asked for.
    console.warn(`agent asked to open an asset this window cannot find: ${assetId}`);
    return;
  }

  const store = useProjectStore.getState();
  await store.load();
  await useProjectStore.getState().selectProject(result.value.asset.projectId);
  await useProjectStore.getState().selectAsset(assetId);
  useShellStore.getState().setScreen('editor');
}

/**
 * Subscribes to the agent's requests, without a component in the way.
 *
 * @returns A function that detaches the listener.
 */
export function subscribeToAgentOpen(): Promise<UnlistenFn> {
  return onDocumentOpened((event) => {
    void openRequestedAsset(event.assetId);
  });
}

/** Follows the agent's `open_asset` calls for as long as the window is open. */
export function useAgentOpen(): void {
  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    void subscribeToAgentOpen().then((detach) => {
      if (mounted) {
        unlisten = detach;
        return;
      }
      // Unmounted while the subscription was still being made: the listener
      // exists, so it has to be taken back off here or it outlives the window.
      detach();
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
}
