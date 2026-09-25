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
 * The name of a sheet of an animation's frames.
 *
 * `export_png` and `export_gif` expand the dialog's pattern on the Rust side
 * (`file_name` and `gif_file_name` in `export.rs`), with the animation root's
 * name for a GIF. `export_sheet` fills `{asset}` and `{kind}` with the word
 * "sheet", though, so for an animation's sheet the dialog fills those two in
 * here, so that one pattern names all three outputs alike: `walk@2x.png`,
 * `walk@2x.gif`, `walk@2x.png` for the sheet.
 */

/** What a pattern's placeholders are replaced with. */
export interface NameParts {
  project: string;
  asset: string;
  kind: string;
  scale: number;
}

/**
 * Replaces `{asset}`, `{kind}` and `{scale}`, and `{project}` too unless it is
 * left for the shell to fill.
 *
 * @param pattern - The dialog's pattern.
 * @param parts - What to put in.
 * @param keepProject - Leaves `{project}` in place for `export_sheet`.
 * @returns The expanded text, not yet made safe.
 */
export function expandPattern(pattern: string, parts: NameParts, keepProject = false): string {
  const expanded = pattern
    .replaceAll('{asset}', parts.asset)
    .replaceAll('{kind}', parts.kind)
    .replaceAll('{scale}', String(parts.scale));
  return keepProject ? expanded : expanded.replaceAll('{project}', parts.project);
}
