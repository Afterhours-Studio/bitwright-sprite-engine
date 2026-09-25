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
 * "3 minutes ago", in the interface's language.
 *
 * `Intl.RelativeTimeFormat` rather than translated strings: it already knows
 * every language's plural rules and word order, and a table of "{{n}} minutes
 * ago" per unit per language would be a second, worse copy of it.
 */

/** The units a gap is expressed in, largest first, with their length in ms. */
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * Renders how long ago a moment was.
 *
 * @param at - The moment, in Unix milliseconds.
 * @param now - The present, in Unix milliseconds.
 * @param locale - The language to write it in.
 * @returns Such as "3 minutes ago" or "now".
 */
export function formatRelative(at: number, now: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const gap = at - now;
  for (const [unit, length] of UNITS) {
    if (Math.abs(gap) >= length) {
      return format.format(Math.round(gap / length), unit);
    }
  }
  // Under a minute reads as "now": seconds tick past faster than anyone
  // looking at a grid of sprites wants to be told.
  return format.format(0, 'second');
}
