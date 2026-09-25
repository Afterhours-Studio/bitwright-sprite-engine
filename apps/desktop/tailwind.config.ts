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

import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

/**
 * The neutral scale, read from CSS variables in `src/styles/tokens.css`.
 *
 * Each variable holds bare RGB channels rather than a colour, which is what
 * lets Tailwind put the opacity modifier inside `rgb()`: `bg-neutral-900/40`
 * only works when the value is written as `rgb(var(--x) / <alpha-value>)`.
 * Going through a variable at all is what keeps the light theme: it inverts
 * the scale in `tokens.css`, so `bg-neutral-950` is near black in dark mode
 * and near white in light mode without a single `dark:` variant in a
 * component.
 */
const neutral = Object.fromEntries(
  ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((step) => [
    step,
    `rgb(var(--neutral-${step}) / <alpha-value>)`,
  ]),
);

/**
 * The theme has two layers of colour, and both are deliberate.
 *
 * The interface is rebuilt one to one on a reference studio written in
 * Tailwind's own palette - `neutral`, `pink`, `sky`, `purple` - so those
 * classes have to exist exactly as Tailwind 3 defines them, or the copy is a
 * paraphrase (DECISIONS.md, "Tailwind's palette comes back, through
 * variables"). The accent scales `pink`, `sky`, `purple`, `red`, `amber` and
 * `emerald` are Tailwind's fixed values, read from `tailwindcss/colors` so
 * they cannot drift from the reference. `neutral` goes through variables, as
 * explained above, because it is the scale the light theme has to invert.
 *
 * The role tokens (`surface-*`, `fg-*`, `accent`, `line-*`) stay beside the
 * scales and are re-pointed at the new look in `tokens.css`. They are what
 * `scripts/check-contrast.ts` measures, and they keep a component that has not
 * been restyled yet matching the ones that have.
 *
 * Radii and shadows are Tailwind's defaults for the same reason as the palette:
 * `rounded`, `rounded-xl` and `shadow-md shadow-pink-600/20` are written into
 * the reference and have to mean what they mean there.
 *
 * Note for anyone adding a token here: Tailwind does not pick up a change to
 * this file while the dev server is running. Restart it, or the new class will
 * simply not exist and the result will look like a broken token rather than a
 * missing class.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // `colors` replaces the default palette instead of extending it, so only
    // the scales named here exist: `bg-gray-800` is still not a class.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: colors.white,
      black: colors.black,

      neutral,
      pink: colors.pink,
      sky: colors.sky,
      purple: colors.purple,
      red: colors.red,
      amber: colors.amber,
      emerald: colors.emerald,

      /* The reference's three home-screen greys. They sit between neutral
         steps, so they are tokens of their own rather than a neutral class. */
      studio: {
        home: 'var(--studio-home)',
        'home-side': 'var(--studio-home-side)',
        card: 'var(--studio-card)',
      },

      surface: {
        canvas: 'var(--surface-canvas)',
        content: 'var(--surface-content)',
        'content-alt': 'var(--surface-content-alt)',
        input: 'var(--surface-input)',
        well: 'var(--surface-well)',
        float: 'var(--surface-float)',
        disabled: 'var(--surface-disabled)',
        anchor: 'var(--surface-anchor)',
      },
      fg: {
        primary: 'var(--fg-primary)',
        secondary: 'var(--fg-secondary)',
        muted: 'var(--fg-muted)',
        placeholder: 'var(--fg-placeholder)',
        'on-anchor': 'var(--fg-on-anchor)',
      },
      accent: {
        DEFAULT: 'var(--accent)',
        hover: 'var(--accent-hover)',
        fg: 'var(--accent-fg)',
      },
      line: {
        subtle: 'var(--border-subtle)',
        DEFAULT: 'var(--border-default)',
        strong: 'var(--border-strong)',
        input: 'var(--input-border)',
        focus: 'var(--input-border-focus)',
      },
      /* The Windows close button must use the system red on hover, which is
         not Tailwind's red and belongs to no scale. */
      danger: {
        DEFAULT: '#c42b1c',
        fg: '#ffffff',
      },
    },
    borderColor: ({ theme }) => ({
      ...theme('colors'),
      DEFAULT: 'var(--border-default)',
    }),
    // Tailwind's default scale, with the window's own radii kept beside it.
    borderRadius: {
      none: '0',
      xs: '0.125rem',
      sm: '0.125rem',
      DEFAULT: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      xl: '0.75rem',
      '2xl': '1rem',
      '3xl': '1.5rem',
      pill: 'var(--radius-pill)',
      window: 'var(--radius-window)',
      'window-inner': 'var(--radius-window-inner)',
      full: '9999px',
    },
    extend: {
      // The shadow scale is Tailwind's default, which is what lets a colour
      // modifier such as `shadow-pink-600/20` recolour it. Tailwind 3 has no
      // `shadow-xs`; the reference uses it with the value later versions give
      // it, which is Tailwind 3's `shadow-sm`.
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
        9: 'var(--space-9)',
        10: 'var(--space-10)',
        11: 'var(--space-11)',
        12: 'var(--space-12)',
        titlebar: 'var(--titlebar-height)',
      },
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
