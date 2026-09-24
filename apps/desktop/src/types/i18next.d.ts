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
 * Type-safe translation keys.
 *
 * The English locale files are the schema. `t('nav.editor')` compiles;
 * `t('nav.edito')` does not, and neither does a key from the wrong
 * namespace. English is used as the source because it is the fallback, so it
 * is the locale guaranteed to hold every key.
 */

import type common from '@/locales/en/common.json';
import type editor from '@/locales/en/editor.json';
import type errors from '@/locales/en/errors.json';
import type projects from '@/locales/en/projects.json';
import type reference from '@/locales/en/reference.json';
import type settings from '@/locales/en/settings.json';
import type workflow from '@/locales/en/workflow.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      editor: typeof editor;
      projects: typeof projects;
      reference: typeof reference;
      settings: typeof settings;
      workflow: typeof workflow;
      errors: typeof errors;
    };
    returnNull: false;
  }
}
