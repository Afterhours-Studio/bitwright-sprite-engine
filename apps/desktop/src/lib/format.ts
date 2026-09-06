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
 * Turning engine numbers into figures a person can read.
 *
 * The unit words are passed in rather than looked up here. This module has no
 * hook of its own to call, and a translation fetched at module scope would be
 * fixed at the language the application happened to start in.
 */

/** Bytes in one megabyte, as a disk reports them. */
export const BYTES_PER_MB = 1024 * 1024;

/** Bytes in one gigabyte. */
export const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** The unit words, translated once by the caller and passed down. */
export interface ByteUnits {
  /** Short form for megabytes, such as `MB`. */
  megabytes: string;
  /** Short form for gigabytes, such as `GB`. */
  gigabytes: string;
}

/**
 * Renders a size the way a disk reports it.
 *
 * Gigabytes once a value reaches one, megabytes below that. Model weights are
 * measured in gigabytes, so a raw `4265146304` is a number the reader has to
 * count rather than read, and so is the same figure in megabytes.
 *
 * @param bytes - The size to render. Negative values read as zero, since a
 *   size that went backwards is a bug upstream and not something to show.
 * @param units - Translated unit words.
 * @returns The size with its unit.
 */
export function formatBytes(bytes: number, units: ByteUnits): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe >= BYTES_PER_GB) {
    return `${(safe / BYTES_PER_GB).toFixed(1)} ${units.gigabytes}`;
  }
  return `${Math.round(safe / BYTES_PER_MB)} ${units.megabytes}`;
}
