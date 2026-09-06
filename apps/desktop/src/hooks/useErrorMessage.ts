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

/** Turns a reason code into a message in the user's language. */
export type ErrorTranslator = (code: string | null | undefined) => string | null;

/**
 * Translates the stable reason codes that Rust and Python return.
 *
 * Both sides return codes such as `backend.cuda.driver_missing` rather than
 * prose, precisely so the text can be chosen here. A code with no entry in the
 * `errors` namespace falls back to the generic message rather than showing the
 * user a raw identifier.
 *
 * @returns A function that translates one reason code.
 */
export function useErrorMessage(): ErrorTranslator {
  const { t, i18n } = useTranslation('errors');

  // Reason codes arrive from Rust and Python at run time, so they cannot be
  // members of the static key union that `t` expects. Existence is checked
  // before every lookup, which is what the union would otherwise guarantee.
  const lookup = t as unknown as (key: string) => string;

  return (code) => {
    if (code === null || code === undefined || code === '') {
      return null;
    }
    if (!i18n.exists(`errors:${code}`)) {
      return t('unknown');
    }
    return lookup(code);
  };
}
