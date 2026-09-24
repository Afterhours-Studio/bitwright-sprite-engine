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
 * The export commands, one function per command in `commands/export.rs`,
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
 *
 * The directory always comes from the caller, chosen through
 * `storage_pick_directory` (see `pickDirectory` in `lib/api.ts`). There is no
 * command here that writes anywhere the person did not point at.
 */

import { invoke } from '@/lib/tauri';
import type { ShellResult } from '@/lib/tauri';
import type { ExportResult } from '@/types/export';

/**
 * Renders one asset at `scale` and writes it as a PNG into `directory`.
 *
 * `pattern` names the file; `{project}`, `{asset}`, `{kind}` and `{scale}` are
 * replaced. Refused with `export.exists` when the file is already there and
 * `overwrite` is false.
 */
export function exportPng(
  assetId: string,
  directory: string,
  scale: number,
  pattern: string,
  overwrite: boolean,
): Promise<ShellResult<ExportResult>> {
  return invoke<ExportResult>('export_png', { assetId, directory, scale, pattern, overwrite });
}

/**
 * Renders several assets of the same size side by side, `columns` wide, and
 * writes the sheet as one PNG named `name` into `directory`.
 *
 * Refused with `export.mixed_sizes` when the assets are not all the same
 * size, and `export.empty` when the list is empty.
 */
export function exportSheet(
  assetIds: string[],
  directory: string,
  columns: number,
  scale: number,
  name: string,
  overwrite: boolean,
): Promise<ShellResult<ExportResult>> {
  return invoke<ExportResult>('export_sheet', {
    assetIds,
    directory,
    columns,
    scale,
    name,
    overwrite,
  });
}

/**
 * The MCP exports folder for the current data root.
 *
 * Where an agent's export lands: `<data root>/exports/<project name>/`. An
 * agent cannot name a folder of its own, which is what keeps an MCP tool call
 * from ever writing outside the data root.
 */
export function exportDirectory(): Promise<ShellResult<string>> {
  return invoke<string>('export_directory');
}
