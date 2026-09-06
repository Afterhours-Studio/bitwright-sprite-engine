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

/**
 * Every colour in the theme resolves to a token from `src/styles/tokens.css`.
 * Tailwind's own palette is removed rather than extended, so `bg-gray-800` is
 * not a class that exists. That is deliberate: a stock palette colour would sit
 * outside the elevation system and outside the contrast checks.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // `colors` replaces the default palette instead of extending it.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',

      surface: {
        sunken: 'var(--surface-sunken)',
        canvas: 'var(--surface-canvas)',
        1: 'var(--surface-1)',
        2: 'var(--surface-2)',
        float: 'var(--surface-float)',
        content: 'var(--surface-content)',
        disabled: 'var(--surface-disabled)',
      },
      fg: {
        primary: 'var(--fg-primary)',
        secondary: 'var(--fg-secondary)',
        muted: 'var(--fg-muted)',
      },
      accent: {
        DEFAULT: 'var(--accent)',
        hover: 'var(--accent-hover)',
        fg: 'var(--accent-fg)',
      },
      anchor: {
        DEFAULT: 'var(--anchor)',
        fg: 'var(--anchor-fg)',
      },
      line: {
        subtle: 'var(--border-subtle)',
        DEFAULT: 'var(--border-default)',
        strong: 'var(--border-strong)',
      },
      /* The only two literal colours in the theme. The Windows close button
         must use the system red on hover, which is not part of the palette. */
      danger: {
        DEFAULT: '#c42b1c',
        fg: '#ffffff',
      },
    },
    borderColor: ({ theme }) => ({
      ...theme('colors'),
      DEFAULT: 'var(--border-default)',
    }),
    borderRadius: {
      none: '0',
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      pill: 'var(--radius-pill)',
      full: '9999px',
    },
    boxShadow: {
      none: 'none',
      sm: 'var(--shadow-sm)',
      md: 'var(--shadow-md)',
      lg: 'var(--shadow-lg)',
    },
    extend: {
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
        statusbar: 'var(--statusbar-height)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
