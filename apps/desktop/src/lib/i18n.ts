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

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from '@/locales/en/common.json';
import enErrors from '@/locales/en/errors.json';
import enGeneration from '@/locales/en/generation.json';
import enSettings from '@/locales/en/settings.json';
import viCommon from '@/locales/vi/common.json';
import viErrors from '@/locales/vi/errors.json';
import viGeneration from '@/locales/vi/generation.json';
import viSettings from '@/locales/vi/settings.json';

/** Languages the application ships. Adding one is documented in docs/development/i18n.md. */
export const LANGUAGES = ['en', 'vi'] as const;

/** A shipped language code. */
export type Language = (typeof LANGUAGES)[number];

/** The language used when nothing is stored, and the fallback for missing keys. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Namespaces, one file per locale. */
export const NAMESPACES = ['common', 'generation', 'settings', 'errors'] as const;

/** A translation namespace. */
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Bundled resources.
 *
 * Translations are compiled in rather than fetched. The application runs
 * offline, and a missing network request would leave the interface showing raw
 * keys.
 */
export const resources = {
  en: {
    common: enCommon,
    generation: enGeneration,
    settings: enSettings,
    errors: enErrors,
  },
  vi: {
    common: viCommon,
    generation: viGeneration,
    settings: viSettings,
    errors: viErrors,
  },
} as const;

const STORAGE_KEY = 'bitwright.language';

/**
 * Reads the stored language, falling back to the default.
 *
 * @returns The language to start in.
 */
export function storedLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null && (LANGUAGES as readonly string[]).includes(stored)) {
      return stored as Language;
    }
  } catch {
    // Storage can be unavailable in a restricted webview. The default is fine.
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Switches language and remembers the choice.
 *
 * @param language - The language to switch to.
 */
export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // A choice that cannot be stored still applies for this session.
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  ns: NAMESPACES,
  interpolation: {
    // React escapes for us; escaping twice would show entities in the UI.
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
