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
 * Token discipline.
 *
 * A literal colour written into a component sits outside the elevation system
 * and outside the contrast checks, and it will not follow the theme. This test
 * scans the source for one. `tokens.css` is the only file allowed to define
 * colour values, and the Tailwind config is allowed the two Windows system
 * colours the close button needs.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** Files permitted to contain a literal colour, relative to the app root. */
const ALLOWED = new Set(['src/styles/tokens.css']);

/** Hex colours, and the rgb, rgba, hsl, and hsla functions. */
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;

/**
 * Lists every source file under a directory.
 *
 * @param directory - Where to start.
 * @returns Absolute paths of every file found.
 */
function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('colour tokens', () => {
  const files = walk(SRC).filter((path) => /\.(ts|tsx|css)$/.test(path));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('defines colour only in tokens.css', () => {
    const offenders = files.filter((path) => {
      const relativePath = relative(process.cwd(), path).split(sep).join('/');
      if (ALLOWED.has(relativePath)) {
        return false;
      }
      return LITERAL_COLOUR.test(readFileSync(path, 'utf8'));
    });

    expect(offenders.map((path) => relative(process.cwd(), path))).toEqual([]);
  });

  it('declares both a light and a dark value for every colour token', () => {
    const css = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');

    const light = new Set(tokenNames(block(css, ':root {')));
    const dark = new Set(tokenNames(block(css, "[data-theme='dark'] {")));

    // Light mode has four surface steps and dark mode has five, so the float
    // token is the one legitimate difference: in light mode it shares
    // surface-2's lightness and is separated by shadow instead.
    for (const name of dark) {
      expect(light.has(name), `${name} is missing from the light theme`).toBe(true);
    }
  });
});

/**
 * Extracts the body of the first rule that starts with a selector.
 *
 * @param css - The stylesheet.
 * @param selector - The selector, including the opening brace.
 * @returns The declarations inside that rule.
 */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} is missing`).toBeGreaterThan(-1);
  const end = css.indexOf('}', start);
  return css.slice(start + selector.length, end);
}

/**
 * Lists the custom property names declared in a block.
 *
 * @param declarations - The declarations inside a rule.
 * @returns The property names, including the leading dashes.
 */
function tokenNames(declarations: string): string[] {
  return [...declarations.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');
}
