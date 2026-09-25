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

import { useEffect } from 'react';

import { useDocumentStore } from '@/stores/useDocumentStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Asset } from '@/types/document';

/**
 * The open asset's row as the project store lists it, if it lists it.
 *
 * @param state - The project store's lists.
 * @param id - The open asset.
 * @returns The listed row, or undefined when neither list has it.
 */
function listed(state: { assets: Asset[]; allAssets: Asset[] }, id: string): Asset | undefined {
  return (
    state.allAssets.find((asset) => asset.id === id) ??
    state.assets.find((asset) => asset.id === id)
  );
}

/**
 * Keeps the open document's name in step with renames.
 *
 * A rename goes through `useProjectStore.renameAsset`, which updates the rows
 * that store lists and nothing else; the document store holds its own copy of
 * the asset row, read when the document was opened. The subscription lives in
 * a hook rather than in either store because the project store already imports
 * the document store, and the reverse import would be a cycle whose evaluation
 * order decides whether the subscription exists at all.
 */
export function useAssetNameSync(): void {
  useEffect(
    () =>
      useProjectStore.subscribe((state) => {
        const { asset, setAssetName } = useDocumentStore.getState();
        if (asset === null) {
          return;
        }
        const row = listed(state, asset.id);
        if (row !== undefined && row.name !== asset.name) {
          setAssetName(asset.id, row.name);
        }
      }),
    [],
  );
}
