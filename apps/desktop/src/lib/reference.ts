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
 * The reference commands, one function per command in `commands/reference.rs`,
 * named after it, so that a command can be found from either side by
 * searching for the same word.
 *
 * Every one returns a {@link ShellResult} rather than throwing, like the rest
 * of the bridge in `lib/tauri.ts`: outside a Tauri window they all report
 * `shell.unavailable`, which is what lets the interface render under Vitest.
 *
 * Argument names are camelCase because Tauri 2 renames command arguments for
 * the webview, so Rust's `asset_id` is `assetId` here. Getting one wrong is
 * not a compile error on either side - it arrives as a missing argument at run
 * time - which is why the names are written once, here, and nowhere else.
 */

import { invoke } from '@/lib/tauri';
import type { ShellResult } from '@/lib/tauri';
import type { Palette } from '@/types/document';
import type { ReferenceSummary } from '@/types/reference';

/** Opens the system file picker; resolves to a path, or null when cancelled. */
export function referencePickFile(): Promise<ShellResult<string | null>> {
  return invoke<string | null>('reference_pick_file');
}

/**
 * Imports a picture at `path` as a reference for `assetId`, conforming it to
 * the asset's size through the sidecar.
 */
export function referenceImport(
  assetId: string,
  path: string,
  name?: string,
): Promise<ShellResult<ReferenceSummary>> {
  return invoke<ReferenceSummary>('reference_import', { assetId, path, name });
}

/** Lists the references imported for an asset. */
export function referenceList(assetId: string): Promise<ShellResult<ReferenceSummary[]>> {
  return invoke<ReferenceSummary[]>('reference_list', { assetId });
}

/** Reads a reference's pixels as a data URL, for previewing. */
export function referencePreview(
  assetId: string,
  referenceId: string,
): Promise<ShellResult<string>> {
  return invoke<string>('reference_preview', { assetId, referenceId });
}

/** Removes a reference from an asset. */
export function referenceDelete(assetId: string, referenceId: string): Promise<ShellResult<null>> {
  return invoke<null>('reference_delete', { assetId, referenceId });
}

/**
 * Groups a reference's colours into ramps and writes them as the asset's
 * palette. Refused with a `palette.*` or `style.*` code when the style
 * rejects them.
 */
export function referenceApplyPalette(
  assetId: string,
  referenceId: string,
  maxSlots?: number,
): Promise<ShellResult<Palette>> {
  return invoke<Palette>('reference_apply_palette', { assetId, referenceId, maxSlots });
}
