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

import { useEffect } from 'react';

import { useShellStore } from '@/stores/useShellStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useToastStore } from '@/stores/useToastStore';

/**
 * Raises a notification for the failures the stores already record but nothing
 * shows.
 *
 * WHY THIS IS A SUBSCRIBER AND NOT A CALL AT EACH SITE
 *
 * Every one of these failures is already written down. `useShellStore` keeps
 * the sidecar's reason code and the window effect's; `useDocumentStore` keeps
 * one for whatever command failed last. They were dead ends: a code was stored
 * and, unless the user happened to be looking at the one card that renders it,
 * nothing ever said so.
 *
 * The document's failures are also shown in place - a refused palette under the
 * palette, a refused advance under the step rail - and that is deliberate
 * duplication rather than an oversight. The panel says it where the decision
 * was made, and the notification is what is still there once the panel has been
 * scrolled past or the screen changed.
 *
 * Watching the stores rather than editing them keeps the reporting in one place
 * and keeps it out of the state. A store that raised its own toasts would have
 * to know about the interface, and every future caller would have to remember
 * to do it; a store that only records leaves this file as the single thing to
 * read when asking what the user is told about.
 */
export function useToastBridge(): void {
  useEffect(() => {
    const notify = useToastStore.getState().notify;

    const shell = useShellStore.subscribe((state, previous) => {
      if (state.sidecar.error !== previous.sidecar.error && state.sidecar.error !== '') {
        notify({
          severity: 'error',
          titleKey: 'common:notifications.engineFailed',
          messageKey: `errors:${state.sidecar.error}`,
        });
      }

      // Only a real failure. The window effect being off because this is
      // Windows 10, or because the platform has no such effect, is a fact about
      // the machine rather than something that went wrong, and a toast about it
      // on every single launch is noise the user cannot switch off.
      if (
        state.vibrancy !== previous.vibrancy &&
        !state.vibrancy.applied &&
        state.vibrancy.reason === 'vibrancy.apply_failed'
      ) {
        notify({ severity: 'warning', messageKey: 'errors:vibrancy.apply_failed' });
      }
    });

    const document = useDocumentStore.subscribe((state, previous) => {
      if (state.error !== previous.error && state.error !== null) {
        notify({
          severity: 'error',
          titleKey: 'common:notifications.documentFailed',
          messageKey: `errors:${state.error}`,
        });
      }
    });

    return () => {
      shell();
      document();
    };
  }, []);
}
