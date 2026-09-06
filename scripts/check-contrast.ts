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
 * Verifies the colour tokens.
 *
 * The design system makes numeric promises, and a promise nobody checks is a
 * comment. This script reads `tokens.css` and enforces them:
 *
 *   1. Adjacent surfaces differ by at least 0.040 L in light mode and 0.050 L
 *      in dark mode, in OKLCH.
 *   2. Every text token clears WCAG on every surface it is declared for:
 *      4.5:1 for body text, 3:1 for large text.
 *   3. The accent foreground clears its accent background in both modes.
 *   4. Both modes declare the same set of tokens.
 *
 * Run with `npx tsx scripts/check-contrast.ts` from the repository root, or
 * `npm run check:contrast` from `apps/desktop`. Exits non-zero on a failure,
 * which is what makes the contrast-check CI job block a merge.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { converter, wcagContrast, type Oklch } from 'culori';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '..', 'apps', 'desktop', 'src', 'styles', 'tokens.css');

/** Selector that opens each mode's token block. */
const BLOCKS = {
  light: ':root {',
  dark: "[data-theme='dark'] {",
} as const;

/** A colour mode. */
type Mode = keyof typeof BLOCKS;

/** Slack for binary floating point when comparing a step against its minimum. */
const EPSILON = 1e-9;

/** The minimum lightness step between two touching surfaces, per mode. */
const MIN_STEP: Record<Mode, number> = {
  light: 0.04,
  // The eye separates dark values less well, so dark mode needs a wider step.
  dark: 0.05,
};

/**
 * Surfaces that touch, in elevation order.
 *
 * Light mode stops at surface-2. It has four steps rather than five, because
 * it is capped at L = 1.0 and a fifth would collide with the fourth; the
 * floating layer is separated by shadow there, which no numeric check covers.
 */
const ADJACENT: Record<Mode, [string, string][]> = {
  light: [
    ['--surface-sunken', '--surface-canvas'],
    ['--surface-canvas', '--surface-1'],
    ['--surface-1', '--surface-2'],
  ],
  dark: [
    ['--surface-sunken', '--surface-canvas'],
    ['--surface-canvas', '--surface-1'],
    ['--surface-1', '--surface-2'],
    ['--surface-2', '--surface-float'],
  ],
};

/** Whether a pairing carries body text or only large text. */
type TextSize = 'body' | 'large';

/** The minimum ratio for each text size. */
const MIN_RATIO: Record<TextSize, number> = { body: 4.5, large: 3 };

/**
 * Which surfaces each foreground token is cleared for.
 *
 * This is the contract the design system states in prose. Using a foreground
 * on a surface that is not listed here is a bug even when it happens to pass,
 * because the pairing has not been reviewed.
 */
const TEXT_ON: { fg: string; bg: string; size: TextSize }[] = [
  { fg: '--fg-primary', bg: '--surface-sunken', size: 'body' },
  { fg: '--fg-primary', bg: '--surface-canvas', size: 'body' },
  { fg: '--fg-primary', bg: '--surface-1', size: 'body' },
  { fg: '--fg-primary', bg: '--surface-2', size: 'body' },
  { fg: '--fg-primary', bg: '--surface-float', size: 'body' },
  { fg: '--fg-primary', bg: '--surface-content', size: 'body' },

  { fg: '--fg-secondary', bg: '--surface-sunken', size: 'body' },
  { fg: '--fg-secondary', bg: '--surface-canvas', size: 'body' },
  { fg: '--fg-secondary', bg: '--surface-1', size: 'body' },
  { fg: '--fg-secondary', bg: '--surface-2', size: 'body' },
  { fg: '--fg-secondary', bg: '--surface-float', size: 'body' },
  { fg: '--fg-secondary', bg: '--surface-content', size: 'body' },

  { fg: '--anchor-fg', bg: '--anchor', size: 'body' },

  // Yellow is far too light for white text, which is why the accent foreground
  // is dark in both modes rather than flipping with the theme.
  { fg: '--accent-fg', bg: '--accent', size: 'body' },
  { fg: '--accent-fg', bg: '--accent-hover', size: 'body' },
];

/**
 * The one exempt pairing, listed so that the exemption is a decision on the
 * record rather than an omission.
 *
 * WCAG 1.4.3 exempts the text of a disabled control, and nothing else. It does
 * not extend to text that carries information, however quiet that text looks.
 * The reason an engine cannot be used is something the user has to read in
 * order to fix it, so it uses --fg-secondary and is measured at 4.5:1 like any
 * other sentence.
 *
 * That is why --fg-muted appears nowhere in TEXT_ON. It has exactly one
 * legitimate pairing, and this is it.
 */
const EXEMPT: { fg: string; bg: string; reason: string }[] = [
  {
    fg: '--fg-muted',
    bg: '--surface-disabled',
    reason: 'the label of a disabled control, exempt under WCAG 1.4.3',
  },
];

const toOklch = converter('oklch');

interface Failure {
  mode: Mode;
  check: string;
  detail: string;
}

const failures: Failure[] = [];

/**
 * Extracts the declarations of one rule.
 *
 * @param css - The stylesheet.
 * @param selector - The selector, including the opening brace.
 * @returns The declarations inside that rule.
 */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`tokens.css has no rule for ${selector}`);
  }
  const end = css.indexOf('}', start);
  return css.slice(start + selector.length, end);
}

/**
 * Reads every custom property in a rule.
 *
 * @param declarations - The declarations inside a rule.
 * @returns Property names mapped to their raw values.
 */
function parseTokens(declarations: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of declarations.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      tokens.set(name, value.trim());
    }
  }
  return tokens;
}

/**
 * Parses a token value as a colour.
 *
 * @param tokens - The mode's tokens.
 * @param name - The token to read.
 * @returns The colour in OKLCH, or null when the value is not a colour.
 */
function colour(tokens: Map<string, string>, name: string): Oklch | null {
  const value = tokens.get(name);
  if (value === undefined) {
    return null;
  }
  return toOklch(value) ?? null;
}

/**
 * Selects the tokens whose value is a colour.
 *
 * A shadow is excluded even though it contains a colour, because its value is
 * a shadow definition rather than a colour on its own.
 *
 * @param tokens - A mode's tokens.
 * @returns The names of the colour tokens.
 */
function colourTokens(tokens: Map<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [name, value] of tokens) {
    if (name.startsWith('--shadow-')) {
      continue;
    }
    if (toOklch(value) !== undefined) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Formats a number to three decimal places.
 *
 * @param value - The number.
 * @returns The formatted number.
 */
function fixed(value: number): string {
  return value.toFixed(3);
}

/** Pads a string to a column width. */
function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * Checks the lightness steps between touching surfaces.
 *
 * @param mode - Which mode is being checked.
 * @param tokens - That mode's tokens.
 */
function checkElevation(mode: Mode, tokens: Map<string, string>): void {
  console.log(`\n  Elevation steps (minimum ${fixed(MIN_STEP[mode])} L)`);

  for (const [lower, upper] of ADJACENT[mode]) {
    const from = colour(tokens, lower);
    const to = colour(tokens, upper);

    if (from === null || to === null) {
      failures.push({
        mode,
        check: 'elevation',
        detail: `${lower} or ${upper} is missing`,
      });
      continue;
    }

    const delta = (to.l ?? 0) - (from.l ?? 0);
    // A step written as exactly the minimum lands a fraction below it once the
    // two values have been through binary floating point, so the comparison
    // allows for that rather than failing a token file that is correct.
    const ok = delta >= MIN_STEP[mode] - EPSILON;
    console.log(`    ${ok ? 'pass' : 'FAIL'}  ${pad(`${lower} -> ${upper}`, 42)} ${fixed(delta)}`);

    if (!ok) {
      failures.push({
        mode,
        check: 'elevation',
        detail: `${lower} -> ${upper} is ${fixed(delta)} L, short by ${fixed(MIN_STEP[mode] - delta)}`,
      });
    }
  }
}

/**
 * Checks every declared text and surface pairing.
 *
 * @param mode - Which mode is being checked.
 * @param tokens - That mode's tokens.
 */
function checkContrast(mode: Mode, tokens: Map<string, string>): void {
  console.log('\n  Text contrast');

  for (const { fg, bg, size } of TEXT_ON) {
    const foreground = colour(tokens, fg);
    const background = colour(tokens, bg);

    if (foreground === null || background === null) {
      failures.push({
        mode,
        check: 'contrast',
        detail: `${fg} or ${bg} is missing`,
      });
      continue;
    }

    const ratio = wcagContrast(foreground, background);
    const required = MIN_RATIO[size];
    const ok = ratio >= required;
    console.log(
      `    ${ok ? 'pass' : 'FAIL'}  ${pad(`${fg} on ${bg}`, 42)} ${ratio.toFixed(2)}:1 (${size}, needs ${required}:1)`,
    );

    if (!ok) {
      failures.push({
        mode,
        check: 'contrast',
        detail: `${fg} on ${bg} is ${ratio.toFixed(2)}:1, short of ${required}:1 for ${size} text`,
      });
    }
  }

  for (const { fg, bg, reason } of EXEMPT) {
    const foreground = colour(tokens, fg);
    const background = colour(tokens, bg);
    if (foreground !== null && background !== null) {
      const ratio = wcagContrast(foreground, background);
      console.log(`    skip  ${pad(`${fg} on ${bg}`, 42)} ${ratio.toFixed(2)}:1 (${reason})`);
    }
  }
}

/**
 * Checks that both modes declare the same colour tokens.
 *
 * Only colours are compared. The radius, spacing, and layout scales are the
 * same in both modes by design, and are declared once.
 *
 * @param light - The light mode tokens.
 * @param dark - The dark mode tokens.
 */
function checkParity(light: Map<string, string>, dark: Map<string, string>): void {
  console.log('\n  Token parity');

  const lightColours = colourTokens(light);
  const darkColours = colourTokens(dark);

  const missingInDark = [...lightColours].filter((name) => !darkColours.has(name));
  const missingInLight = [...darkColours].filter((name) => !lightColours.has(name));

  for (const name of missingInDark) {
    failures.push({
      mode: 'dark',
      check: 'parity',
      detail: `${name} is missing`,
    });
  }
  for (const name of missingInLight) {
    failures.push({
      mode: 'light',
      check: 'parity',
      detail: `${name} is missing`,
    });
  }

  if (missingInDark.length === 0 && missingInLight.length === 0) {
    console.log(`    pass  both modes declare ${lightColours.size} colour tokens`);
  } else {
    console.log(`    FAIL  missing in dark: ${missingInDark.join(', ') || 'none'}`);
    console.log(`    FAIL  missing in light: ${missingInLight.join(', ') || 'none'}`);
  }
}

function main(): void {
  const css = readFileSync(TOKENS, 'utf8');
  const modes: Record<Mode, Map<string, string>> = {
    light: parseTokens(ruleBody(css, BLOCKS.light)),
    dark: parseTokens(ruleBody(css, BLOCKS.dark)),
  };

  console.log('Bitwright colour token check');
  console.log(`Source: ${TOKENS}`);

  for (const mode of Object.keys(modes) as Mode[]) {
    console.log(`\n${mode.toUpperCase()} MODE`);
    checkElevation(mode, modes[mode]);
    checkContrast(mode, modes[mode]);
  }

  checkParity(modes.light, modes.dark);

  console.log('');
  if (failures.length === 0) {
    console.log('All checks passed.');
    return;
  }

  console.log(`${failures.length} check(s) failed:`);
  for (const failure of failures) {
    console.log(`  [${failure.mode}] ${failure.check}: ${failure.detail}`);
  }
  process.exitCode = 1;
}

main();
