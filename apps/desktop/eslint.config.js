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

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Literal colour values, which belong in `src/styles/tokens.css` and nowhere else. */
const COLOUR_LITERAL = String.raw`^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?)\(.*)$`;

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false },
      ],

      // A colour written into a component sits outside the elevation system,
      // outside the contrast checks, and does not follow the theme.
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${COLOUR_LITERAL}/]`,
          message:
            'Use a token from src/styles/tokens.css, through a Tailwind class such as bg-surface-2. Literal colours are not checked for contrast and do not follow the theme.',
        },
        {
          selector: `TemplateElement[value.raw=/${COLOUR_LITERAL}/]`,
          message:
            'Use a token from src/styles/tokens.css, through a Tailwind class such as bg-surface-2. Literal colours are not checked for contrast and do not follow the theme.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    rules: {
      // Tests deliberately contain colour patterns, because they are what the
      // token discipline checks search for.
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    // Build configuration runs in Node and is not part of the typed program,
    // so the type-aware rules are switched off here rather than pointed at a
    // second tsconfig that exists only to satisfy them.
    files: ['*.config.{ts,js}', 'eslint.config.js'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.node,
      parserOptions: { project: false },
    },
  },
);
