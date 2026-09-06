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
 * Locale parity.
 *
 * A key that exists in English but not in Vietnamese silently falls back to
 * English at run time, which looks like a bug to a Vietnamese speaker and is
 * easy to miss in review. This test makes it a build failure instead.
 */

import { describe, expect, it } from 'vitest';

import { LANGUAGES, NAMESPACES, resources } from '@/lib/i18n';

type Tree = { [key: string]: string | Tree };

/**
 * Flattens a namespace into dotted key paths.
 *
 * @param tree - The namespace object.
 * @param prefix - Prefix accumulated so far.
 * @returns Every leaf key, dotted.
 */
function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [path] : flatten(value, path);
  });
}

describe('locales', () => {
  it.each(NAMESPACES)('has the same keys in every language for %s', (namespace) => {
    const english = flatten(resources.en[namespace]).sort();

    for (const language of LANGUAGES) {
      const keys = flatten(resources[language][namespace]).sort();
      expect(keys, `namespace ${namespace} in ${language}`).toEqual(english);
    }
  });

  it.each(NAMESPACES)('has no empty string in %s', (namespace) => {
    for (const language of LANGUAGES) {
      const json = JSON.stringify(resources[language][namespace]);
      expect(json, `namespace ${namespace} in ${language}`).not.toContain('""');
    }
  });

  it('uses no emoji anywhere', () => {
    // Emoji are excluded from the whole project, and locale files are the one
    // place where a translator might reach for one.
    const emoji = /\p{Extended_Pictographic}/u;
    for (const language of LANGUAGES) {
      for (const namespace of NAMESPACES) {
        const json = JSON.stringify(resources[language][namespace]);
        expect(emoji.test(json), `namespace ${namespace} in ${language}`).toBe(false);
      }
    }
  });
});
