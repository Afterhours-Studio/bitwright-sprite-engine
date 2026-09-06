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

import { useTranslation } from 'react-i18next';

/** Turns a notification's key and values into a sentence. */
export type ToastTranslator = (
  key: string,
  values: Record<string, string | number> | null,
) => string;

/**
 * Translates the keys a notification carries.
 *
 * A notification stores a key rather than a sentence, and most of those keys
 * are reason codes that Rust and Python chose at run time. Two consequences,
 * and this hook exists for both:
 *
 * A code with no entry falls back to the generic error message rather than
 * putting a raw identifier such as `models.download_rejected` in front of the
 * user. That is the same rule `useErrorMessage` applies, generalised to a key
 * that names its own namespace, because a notification's body can come from
 * `errors` or from `common` and the caller is the one that knows which.
 *
 * The lookup happens where the notification is drawn, so switching language
 * retranslates the toasts on screen and the whole history behind them.
 *
 * @returns A function that translates one key.
 */
export function useToastText(): ToastTranslator {
  const { t, i18n } = useTranslation();

  // Keys arrive at run time, so they cannot be members of the static key union
  // `t` expects. Existence is checked before every lookup, which is what the
  // union would otherwise guarantee.
  const lookup = t as unknown as (key: string, values?: Record<string, string | number>) => string;

  return (key, values) => {
    if (!i18n.exists(key)) {
      return lookup('errors:unknown');
    }
    return values === null ? lookup(key) : lookup(key, values);
  };
}
