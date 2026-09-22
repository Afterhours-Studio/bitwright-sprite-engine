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
 * A palette slot's bytes, in the forms a browser takes.
 *
 * WHY HEX, AND WHY ASSEMBLED. A colour written into a component sits outside
 * the token system, so both the lint rule and `test/tokens.test.ts` refuse any
 * source file containing a hex colour or one of the CSS colour functions -
 * including this sentence, which is why neither is spelled out in it. These
 * strings are built from bytes at run time and contain no such literal, which
 * is the point: the discipline stays strict, and a sprite's own pixel, which is
 * what a slot is, can still reach the screen.
 *
 * Eight digits rather than six, so a slot's alpha survives. A slot at partial
 * alpha over the transparency checker reads as partly transparent; the same
 * slot forced to opaque reads as a slightly different flat colour, which is
 * the one thing a palette must never do.
 */

/** A slot's bytes, as they arrive from the document. */
export type Rgba = readonly [number, number, number, number];

/**
 * A slot's bytes as `#rrggbbaa`.
 *
 * @param rgba - The slot's bytes.
 * @param alpha - An alpha byte to use instead of the slot's own, for a preview
 *   that has to read as provisional.
 * @returns An eight digit hex string.
 */
export function toHexa(rgba: Rgba, alpha?: number): string {
  const channels = [rgba[0], rgba[1], rgba[2], alpha ?? rgba[3]];
  return `#${channels.map(byte).join('')}`;
}

/**
 * A slot's bytes as the `#rrggbb` a colour input takes.
 *
 * Alpha is dropped rather than encoded, because the input has nowhere to show
 * it; {@link fromHex} carries it across unchanged.
 *
 * @param rgba - The slot's bytes.
 * @returns A six digit hex string.
 */
export function toHex(rgba: Rgba): string {
  return `#${[rgba[0], rgba[1], rgba[2]].map(byte).join('')}`;
}

/**
 * The bytes a colour input produced, with the slot's own alpha kept.
 *
 * @param hex - The input's value, `#rrggbb`.
 * @param alpha - The alpha the slot already had.
 * @returns The slot's new bytes.
 */
export function fromHex(hex: string, alpha: number): [number, number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, alpha];
}

/**
 * One byte, as two hex digits.
 *
 * Clamped and rounded rather than trusted, because a byte outside 0 to 255
 * would produce a hex string of the wrong length and a colour the browser
 * silently ignores, leaving a swatch that is simply not drawn.
 *
 * @param value - The channel.
 * @returns Two lowercase hex digits.
 */
function byte(value: number): string {
  const bounded = Math.min(255, Math.max(0, Math.round(value)));
  return bounded.toString(16).padStart(2, '0');
}
