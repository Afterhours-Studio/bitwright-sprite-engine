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
 * The previous version of this script passed while the running interface had
 * text nobody could read. It checked each surface against the foregrounds it
 * was *expected* to carry, so a token used somewhere unexpected, or a token
 * added later, was never measured at all. `--fg-placeholder` did not exist in
 * its list, and so was never checked on any surface.
 *
 * This version takes no list of expected pairings. It discovers every
 * foreground and every surface declared in `tokens.css` and measures the full
 * matrix. A pair that fails must appear in EXEMPT with a reason, or the check
 * fails. Adding a token therefore forces a decision about where it may be used,
 * rather than silently adding an unmeasured one.
 *
 * Four checks:
 *
 *   1. Exhaustive contrast. Every foreground against every surface that is
 *      allowed to carry text, at 4.5:1.
 *   2. Non-exemptible pairs. A short list that may never be waived, whatever
 *      EXEMPT says. Placeholder text on an input is the first entry, because
 *      that is the pair the old script missed.
 *   3. Separation, with a different rule per mode, read from the @separation
 *      declarations in tokens.css rather than guessed.
 *   4. Parity. Both modes declare the same colour tokens.
 *
 * Run with `npx tsx scripts/check-contrast.ts` from the repository root, or
 * `npm run check:contrast`. Exits non-zero on a failure, which is what makes
 * the contrast-check CI job block a merge.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { converter, wcagContrast, type Oklch } from 'culori';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '..', 'apps', 'desktop', 'src', 'styles', 'tokens.css');

/** A colour mode. */
type Mode = 'light' | 'dark';

const MODES: Mode[] = ['light', 'dark'];

/**
 * Matches the opening of each mode's block.
 *
 * Anchored, so that the translucent variant, whose selector also ends in
 * `[data-theme='dark']`, is not mistaken for the dark mode block.
 */
const BLOCK_START: Record<Mode, RegExp> = {
  light: /^:root\s*\{/m,
  dark: /^\[data-theme='dark'\]\s*\{/m,
};

/** Slack for binary floating point when comparing against a minimum. */
const EPSILON = 1e-9;

/** The contrast every text pairing must clear. */
const MIN_RATIO = 4.5;

/** Minimum lightness step, when lightness is the mechanism. */
const MIN_STEP: Record<Mode, number> = {
  // Dark mode has one mechanism and one threshold. Shadow is invisible against
  // a dark ground, and a border alone does not carry a surface boundary there.
  dark: 0.05,
  // Light mode only needs this when a pair actually declares `lightness`.
  light: 0.04,
};

/** Minimum alpha for a border to count as a separation mechanism. */
const MIN_BORDER_ALPHA = 0.14;

/** Minimum alpha for a shadow to count as a separation mechanism. */
const MIN_SHADOW_ALPHA = 0.06;

/**
 * Surfaces that are allowed to carry text.
 *
 * Anything not listed here is decorative. `--surface-well` is the only one:
 * the sprite checkerboard, slider tracks, and progress backgrounds never hold
 * a label of their own.
 */
const TEXT_BEARING = new Set([
  '--surface-canvas',
  '--surface-content',
  '--surface-content-alt',
  '--surface-input',
  '--surface-float',
  '--surface-disabled',
  '--surface-anchor',
  '--accent',
  '--accent-hover',
]);

/** Surfaces that exist but must never carry text. */
const DECORATIVE = new Set(['--surface-well']);

/**
 * Pairs that may never be waived, whatever EXEMPT says.
 *
 * Placeholder text is read, so it is not decoration, and it is the pair the
 * previous script missed entirely.
 */
const NON_EXEMPTIBLE: [string, string][] = [
  ['--fg-placeholder', '--surface-input'],
  ['--fg-primary', '--surface-content'],
  ['--fg-secondary', '--surface-content'],
  ['--fg-on-anchor', '--surface-anchor'],
  ['--accent-fg', '--accent'],
];

/**
 * Builds out-of-scope entries for one foreground.
 *
 * @param fg - The foreground token.
 * @param surfaces - Surfaces the token is not used on.
 * @returns One exemption entry per surface.
 */
function outOfScope(
  fg: string,
  surfaces: string[],
): { fg: string; bg: string; kind: 'unused'; reason: string }[] {
  return surfaces.map((bg) => ({
    fg,
    bg,
    kind: 'unused' as const,
    reason: `${fg} is not used on ${bg}`,
  }));
}

/**
 * Pairings that are not required to pass, each with the reason.
 *
 * Two kinds of reason, and only two:
 *
 *   unused  The combination does not occur in the interface. The token has a
 *           declared scope, stated beside it in tokens.css, and this pairing is
 *           outside it. Listing it is how that scope is enforced rather than
 *           merely documented.
 *   wcag    WCAG 1.4.3 exempts the text of a disabled control. It exempts
 *           nothing else, which is why there is exactly one such entry.
 */
const EXEMPT: { fg: string; bg: string; kind: 'unused' | 'wcag'; reason: string }[] = [
  {
    fg: '--fg-muted',
    bg: '--surface-disabled',
    kind: 'wcag',
    reason: 'the label of a disabled control, exempt under WCAG 1.4.3',
  },

  // --fg-muted is scoped to disabled controls, so every other surface is out
  // of scope for it.
  ...outOfScope('--fg-muted', [
    '--surface-canvas',
    '--surface-content',
    '--surface-content-alt',
    '--surface-input',
    '--surface-float',
    '--surface-anchor',
    '--accent',
    '--accent-hover',
  ]),

  // --fg-placeholder only ever appears inside an input.
  ...outOfScope('--fg-placeholder', [
    '--surface-canvas',
    '--surface-content',
    '--surface-content-alt',
    '--surface-float',
    '--surface-disabled',
    '--surface-anchor',
    '--accent',
    '--accent-hover',
  ]),

  // --fg-on-anchor only ever appears on the anchor.
  ...outOfScope('--fg-on-anchor', [
    '--surface-canvas',
    '--surface-content',
    '--surface-content-alt',
    '--surface-input',
    '--surface-float',
    '--surface-disabled',
    '--accent',
    '--accent-hover',
  ]),

  // --accent-fg only ever appears on the accent.
  ...outOfScope('--accent-fg', [
    '--surface-canvas',
    '--surface-content',
    '--surface-content-alt',
    '--surface-input',
    '--surface-float',
    '--surface-disabled',
    '--surface-anchor',
  ]),

  // The anchor is a dark bar in both modes and carries only --fg-on-anchor.
  ...outOfScope('--fg-primary', ['--surface-anchor']),
  ...outOfScope('--fg-secondary', ['--surface-anchor']),

  // An accent background carries --accent-fg and nothing else. Body text on
  // bright yellow measures 1.38:1 in dark mode, which is exactly why the accent
  // has a foreground token of its own.
  ...outOfScope('--fg-primary', ['--accent', '--accent-hover']),
  ...outOfScope('--fg-secondary', ['--accent', '--accent-hover']),
];

const toOklch = converter('oklch');

interface Failure {
  mode: Mode | 'both';
  check: string;
  detail: string;
}

const failures: Failure[] = [];

/** One declared separation between two adjacent surfaces. */
interface Separation {
  lower: string;
  upper: string;
  mechanism: 'lightness' | 'border' | 'shadow';
  /** Token the mechanism is carried by, for border and shadow. */
  token: string | null;
}

/**
 * Removes comments.
 *
 * The scope notes beside each token contain prose like
 * "4.5:1 on --surface-input: a placeholder is read", which the declaration
 * pattern matches happily, swallowing the real declaration that follows it and
 * making a token look as though it were never declared. Comments are stripped
 * before declarations are read, and the @separation lines are read from the raw
 * file instead, since those live in a comment on purpose.
 *
 * @param css - The stylesheet.
 * @returns The stylesheet with every comment removed.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extracts the declarations of one mode's block.
 *
 * @param css - The stylesheet.
 * @param mode - Which mode to read.
 * @returns The declarations inside that rule.
 */
function ruleBody(css: string, mode: Mode): string {
  const match = BLOCK_START[mode].exec(css);
  if (match?.index === undefined) {
    throw new Error(`tokens.css has no block for ${mode} mode`);
  }
  const start = match.index + match[0].length;
  return css.slice(start, css.indexOf('}', start));
}

/**
 * Reads every custom property in a block.
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
 * Reads the @separation declarations.
 *
 * The mechanism may name the token that carries it, as `border(--input-border)`
 * or `shadow(--shadow-md)`. Without one, the default token for that mechanism
 * is used.
 *
 * @param css - The stylesheet.
 * @returns The declared adjacencies.
 */
function parseSeparations(css: string): Separation[] {
  const pattern =
    /@separation\s+(surface-[a-z-]+)\s*>\s*(surface-[a-z-]+)\s*:\s*(lightness|border|shadow)(?:\(\s*(--[a-z0-9-]+)\s*\))?/g;

  const declared: Separation[] = [];
  for (const match of css.matchAll(pattern)) {
    const [, lower, upper, mechanism, token] = match;
    if (lower === undefined || upper === undefined || mechanism === undefined) {
      continue;
    }
    declared.push({
      lower: `--${lower}`,
      upper: `--${upper}`,
      mechanism: mechanism as Separation['mechanism'],
      token: token ?? null,
    });
  }
  return declared;
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
 * Returns the largest alpha appearing in a token's value.
 *
 * A shadow holds several colours; the strongest is what does the separating.
 *
 * @param tokens - The mode's tokens.
 * @param name - The token to read.
 * @returns The largest alpha found, or zero.
 */
function maxAlpha(tokens: Map<string, string>, name: string): number {
  const value = tokens.get(name);
  if (value === undefined) {
    return 0;
  }
  const alphas = [...value.matchAll(/\/\s*([0-9.]+)\s*\)/g)].map((match) =>
    Number(match[1] ?? '0'),
  );
  return alphas.length === 0 ? 0 : Math.max(...alphas);
}

/**
 * Selects the tokens whose value is a colour.
 *
 * A shadow is excluded even though it contains colours, because its value is a
 * shadow definition rather than a colour on its own.
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

/** Formats a number to three decimal places. */
function fixed(value: number): string {
  return value.toFixed(3);
}

/** Pads a string to a column width. */
function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** Pads a string to a column width, on the left. */
function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

/** Shortens a token name for the matrix header. */
function short(token: string): string {
  return token.replace('--surface-', '').replace('--fg-', '').replace('--', '');
}

/** Looks up an exemption for a pairing. */
function exemption(fg: string, bg: string): (typeof EXEMPT)[number] | undefined {
  return EXEMPT.find((entry) => entry.fg === fg && entry.bg === bg);
}

/** Reports whether a pairing may never be waived. */
function nonExemptible(fg: string, bg: string): boolean {
  return NON_EXEMPTIBLE.some(([a, b]) => a === fg && b === bg);
}

/**
 * Checks every foreground against every text-bearing surface.
 *
 * @param mode - Which mode is being checked.
 * @param tokens - That mode's tokens.
 * @param foregrounds - Every foreground token discovered in the file.
 * @param surfaces - Every surface token discovered in the file.
 */
function checkContrast(
  mode: Mode,
  tokens: Map<string, string>,
  foregrounds: string[],
  surfaces: string[],
): void {
  const carriers = surfaces.filter((surface) => TEXT_BEARING.has(surface));
  const details: string[] = [];

  console.log('\n  Text contrast, every foreground on every text-bearing surface');
  console.log(`    ${pad('', 16)}${carriers.map((s) => padStart(short(s), 12)).join('')}`);

  for (const fg of foregrounds) {
    const cells: string[] = [];

    for (const bg of carriers) {
      const foreground = colour(tokens, fg);
      const background = colour(tokens, bg);

      if (foreground === null || background === null) {
        cells.push(padStart('-', 12));
        failures.push({ mode, check: 'contrast', detail: `${fg} or ${bg} is missing` });
        continue;
      }

      const ratio = wcagContrast(foreground, background);
      const waiver = exemption(fg, bg);
      const passes = ratio >= MIN_RATIO;

      if (waiver !== undefined && nonExemptible(fg, bg)) {
        failures.push({
          mode,
          check: 'contrast',
          detail: `${fg} on ${bg} is in EXEMPT, but this pair may never be waived`,
        });
      }

      if (passes) {
        cells.push(padStart(ratio.toFixed(1), 12));
        if (waiver?.kind === 'wcag') {
          details.push(
            `    note  ${pad(`${fg} on ${bg}`, 44)} now passes at ${ratio.toFixed(2)}:1, the exemption could go`,
          );
        }
        continue;
      }

      if (waiver === undefined) {
        cells.push(padStart(`FAIL ${ratio.toFixed(1)}`, 12));
        failures.push({
          mode,
          check: 'contrast',
          detail: `${fg} on ${bg} is ${ratio.toFixed(2)}:1, short of ${MIN_RATIO}:1, and is not exempt`,
        });
        continue;
      }

      cells.push(padStart(waiver.kind === 'wcag' ? 'wcag' : 'n/a', 12));
      if (waiver.kind === 'wcag') {
        details.push(
          `    wcag  ${pad(`${fg} on ${bg}`, 44)} ${ratio.toFixed(2)}:1, ${waiver.reason}`,
        );
      }
    }

    console.log(`    ${pad(short(fg), 16)}${cells.join('')}`);
  }

  for (const line of details) {
    console.log(line);
  }
  console.log('    n/a = declared unused in EXEMPT, wcag = disabled control exemption');

  // A decorative surface must not be silently treated as text-bearing, and a
  // newly added surface must be classified one way or the other.
  for (const surface of surfaces) {
    if (!TEXT_BEARING.has(surface) && !DECORATIVE.has(surface)) {
      failures.push({
        mode,
        check: 'contrast',
        detail: `${surface} is neither listed as text-bearing nor as decorative`,
      });
    }
  }
}

/**
 * Checks the pairs that may never be waived.
 *
 * @param mode - Which mode is being checked.
 * @param tokens - That mode's tokens.
 */
function checkNonExemptible(mode: Mode, tokens: Map<string, string>): void {
  console.log('\n  Pairs that may never be waived');

  for (const [fg, bg] of NON_EXEMPTIBLE) {
    const foreground = colour(tokens, fg);
    const background = colour(tokens, bg);

    if (foreground === null || background === null) {
      console.log(`    FAIL  ${pad(`${fg} on ${bg}`, 44)} missing`);
      failures.push({ mode, check: 'required', detail: `${fg} or ${bg} is missing` });
      continue;
    }

    const ratio = wcagContrast(foreground, background);
    const ok = ratio >= MIN_RATIO;
    console.log(
      `    ${ok ? 'pass' : 'FAIL'}  ${pad(`${fg} on ${bg}`, 44)} ${ratio.toFixed(2)}:1, needs ${MIN_RATIO}:1`,
    );

    if (!ok) {
      failures.push({
        mode,
        check: 'required',
        detail: `${fg} on ${bg} is ${ratio.toFixed(2)}:1, short by ${(MIN_RATIO - ratio).toFixed(2)}`,
      });
    }
  }
}

/**
 * Checks the declared separations, with a different rule per mode.
 *
 * @param mode - Which mode is being checked.
 * @param tokens - That mode's tokens.
 * @param declared - The adjacencies declared in tokens.css.
 */
function checkSeparation(mode: Mode, tokens: Map<string, string>, declared: Separation[]): void {
  const rule =
    mode === 'dark'
      ? `lightness only, minimum ${fixed(MIN_STEP.dark)} L`
      : `the declared mechanism, lightness minimum ${fixed(MIN_STEP.light)} L`;
  console.log(`\n  Surface separation (${rule})`);

  for (const pair of declared) {
    const lower = colour(tokens, pair.lower);
    const upper = colour(tokens, pair.upper);

    if (lower === null || upper === null) {
      failures.push({
        mode,
        check: 'separation',
        detail: `${pair.lower} or ${pair.upper} is missing`,
      });
      continue;
    }

    const delta = Math.abs((upper.l ?? 0) - (lower.l ?? 0));
    const label = `${short(pair.lower)} > ${short(pair.upper)}`;

    // Dark mode ignores the declared mechanism. Shadow does not register
    // against a dark ground, and a border alone does not carry a boundary
    // there, so lightness is the only mechanism that counts.
    if (mode === 'dark') {
      const ok = delta >= MIN_STEP.dark - EPSILON;
      console.log(
        `    ${ok ? 'pass' : 'FAIL'}  ${pad(label, 38)} lightness  ${fixed(delta)} of ${fixed(MIN_STEP.dark)}`,
      );
      if (!ok) {
        failures.push({
          mode,
          check: 'separation',
          detail: `${label} is ${fixed(delta)} L, short by ${fixed(MIN_STEP.dark - delta)}`,
        });
      }
      continue;
    }

    switch (pair.mechanism) {
      case 'lightness': {
        const ok = delta >= MIN_STEP.light - EPSILON;
        console.log(
          `    ${ok ? 'pass' : 'FAIL'}  ${pad(label, 38)} lightness  ${fixed(delta)} of ${fixed(MIN_STEP.light)}`,
        );
        if (!ok) {
          failures.push({
            mode,
            check: 'separation',
            detail: `${label} declares lightness but is only ${fixed(delta)} L, short by ${fixed(MIN_STEP.light - delta)}`,
          });
        }
        break;
      }

      case 'border': {
        const token = pair.token ?? '--border-default';
        const alpha = maxAlpha(tokens, token);
        const ok = alpha >= MIN_BORDER_ALPHA - EPSILON;
        console.log(
          `    ${ok ? 'pass' : 'FAIL'}  ${pad(label, 38)} border     ${token} at ${alpha.toFixed(2)} of ${MIN_BORDER_ALPHA}`,
        );
        if (!ok) {
          failures.push({
            mode,
            check: 'separation',
            detail: `${label} declares border ${token}, whose alpha ${alpha.toFixed(2)} is below ${MIN_BORDER_ALPHA}`,
          });
        }
        break;
      }

      case 'shadow': {
        const token = pair.token ?? '--shadow-sm';
        const alpha = maxAlpha(tokens, token);
        const ok = alpha >= MIN_SHADOW_ALPHA - EPSILON;
        console.log(
          `    ${ok ? 'pass' : 'FAIL'}  ${pad(label, 38)} shadow     ${token} at ${alpha.toFixed(2)} of ${MIN_SHADOW_ALPHA}`,
        );
        if (!ok) {
          failures.push({
            mode,
            check: 'separation',
            detail: `${label} declares shadow ${token}, whose alpha ${alpha.toFixed(2)} is below ${MIN_SHADOW_ALPHA}`,
          });
        }
        break;
      }
    }
  }
}

/**
 * Checks that both modes declare the same colour tokens.
 *
 * @param light - The light mode tokens.
 * @param dark - The dark mode tokens.
 */
function checkParity(light: Map<string, string>, dark: Map<string, string>): void {
  console.log('\nTOKEN PARITY');

  const lightColours = colourTokens(light);
  const darkColours = colourTokens(dark);

  const missingInDark = [...lightColours].filter((name) => !darkColours.has(name));
  const missingInLight = [...darkColours].filter((name) => !lightColours.has(name));

  for (const name of missingInDark) {
    failures.push({ mode: 'dark', check: 'parity', detail: `${name} is missing` });
  }
  for (const name of missingInLight) {
    failures.push({ mode: 'light', check: 'parity', detail: `${name} is missing` });
  }

  if (missingInDark.length === 0 && missingInLight.length === 0) {
    console.log(`  pass  both modes declare ${lightColours.size} colour tokens`);
  } else {
    console.log(`  FAIL  missing in dark: ${missingInDark.join(', ') || 'none'}`);
    console.log(`  FAIL  missing in light: ${missingInLight.join(', ') || 'none'}`);
  }
}

function main(): void {
  const css = readFileSync(TOKENS, 'utf8');
  const declarations = stripComments(css);
  const modes: Record<Mode, Map<string, string>> = {
    light: parseTokens(ruleBody(declarations, 'light')),
    dark: parseTokens(ruleBody(declarations, 'dark')),
  };
  // From the raw file: the adjacency declarations live in a comment.
  const declared = parseSeparations(css);

  // Discovered from the file, never from a list in this script. That is the
  // whole point: a token added to tokens.css cannot escape being measured.
  const names = [...colourTokens(modes.light)];
  const foregrounds = names.filter((name) => name.startsWith('--fg-') || name === '--accent-fg');
  const surfaces = names.filter((name) => name.startsWith('--surface-') || name === '--accent');

  console.log('Bitwright colour token check');
  console.log(`Source: ${TOKENS}`);
  console.log(
    `Discovered ${foregrounds.length} foreground and ${surfaces.length} surface tokens, ` +
      `and ${declared.length} declared adjacencies.`,
  );

  if (declared.length === 0) {
    failures.push({
      mode: 'both',
      check: 'separation',
      detail: 'tokens.css declares no @separation adjacencies',
    });
  }

  for (const mode of MODES) {
    console.log(`\n${mode.toUpperCase()} MODE`);
    checkSeparation(mode, modes[mode], declared);
    checkNonExemptible(mode, modes[mode]);
    checkContrast(mode, modes[mode], foregrounds, surfaces);
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
