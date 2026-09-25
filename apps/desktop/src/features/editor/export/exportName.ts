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
 * Names for the exports the shell does not name itself.
 *
 * `export_png` expands the dialog's pattern on the Rust side (`file_name` in
 * `export.rs`). `export_gif` takes a finished file path instead, and
 * `export_sheet` fills `{asset}` and `{kind}` with the word "sheet", so for an
 * animation the dialog does that part of the work here, the same way, so that
 * one pattern names all three outputs alike: `walk@2x.png`, `walk@2x.gif`.
 */

/** Windows reserves these stems regardless of extension or case. */
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³'].flatMap((digit) => [
    `COM${digit}`,
    `LPT${digit}`,
  ]),
]);

/** The longest stem written, as in `export.rs`. */
const MAX_STEM_CHARS = 120;

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

/**
 * Makes expanded text safe as a file stem: separators, reserved and control
 * characters become `_`, spaces and dots are trimmed from both ends, a
 * reserved stem is escaped and a long one is cut.
 *
 * @param text - The expanded pattern.
 * @returns The stem, or null when nothing is left of it.
 */
function safeStem(text: string): string | null {
  const replaced = Array.from(text, (char) =>
    char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f || '<>:"/\\|?*'.includes(char)
      ? '_'
      : char,
  ).join('');
  const trimmed = replaced.replace(/^[ .]+|[ .]+$/g, '');
  // A pattern written for the PNG export may carry its extension; the GIF
  // gets its own instead of `name.png.gif`.
  let stem = trimmed.replace(/\.(png|gif)$/i, '');
  if (stem === '') {
    return null;
  }
  const head = (stem.split('.')[0] ?? '').replace(/ +$/, '').toUpperCase();
  if (RESERVED.has(head)) {
    stem = `_${stem}`;
  }
  return Array.from(stem).slice(0, MAX_STEM_CHARS).join('');
}

/**
 * The file an animation's GIF is written to.
 *
 * @param directory - The folder the person picked.
 * @param pattern - The dialog's pattern.
 * @param parts - What the placeholders stand for.
 * @returns The full path, or null when the pattern names nothing.
 */
export function gifPath(directory: string, pattern: string, parts: NameParts): string | null {
  const stem = safeStem(expandPattern(pattern, parts));
  if (stem === null) {
    return null;
  }
  // The picker hands back a native path; the separator it already uses is
  // the one to join with.
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
  const base = directory.endsWith(separator) ? directory.slice(0, -1) : directory;
  return `${base}${separator}${stem}.gif`;
}
