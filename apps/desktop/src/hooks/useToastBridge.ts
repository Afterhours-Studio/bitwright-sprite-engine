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

import { useEngineStore } from '@/stores/useEngineStore';
import { useGenerationStore } from '@/stores/useGenerationStore';
import { useShellStore } from '@/stores/useShellStore';
import { useToastStore } from '@/stores/useToastStore';
import type { ModelInfo } from '@/types/engine';

/**
 * Raises a notification for the failures the stores already record but nothing
 * shows.
 *
 * WHY THIS IS A SUBSCRIBER AND NOT A CALL AT EACH SITE
 *
 * Every one of these failures is already written down. `useEngineStore` keeps a
 * reason code for the last engine failure, one per model for a download, and
 * the sidecar's own; `useGenerationStore` keeps one for the last run;
 * `useShellStore` keeps the window effect's reason and the startup GPU probe.
 * They were dead ends: a code was stored and, unless the user happened to be
 * looking at the one card that renders it, nothing ever said so.
 *
 * Watching the stores rather than editing them keeps the reporting in one place
 * and keeps it out of the state. A store that raised its own toasts would have
 * to know about the interface, and every future caller would have to remember
 * to do it; a store that only records leaves this file as the single thing to
 * read when asking what the user is told about.
 *
 * ONE FAILURE, ONE NOTIFICATION
 *
 * The engine store writes several fields in a single update. A refused download
 * sets the model's code and the store-wide code together, and a sidecar failure
 * sets the sidecar's code and the store-wide code together. Reporting each
 * field would show the same failure two or three times, so the specific report
 * wins and the store-wide code is only used when nothing more precise changed.
 */
export function useToastBridge(): void {
  useEffect(() => {
    const notify = useToastStore.getState().notify;

    /**
     * Finds a model in the previous list.
     *
     * @param models - The previous model list.
     * @param modelId - Which model.
     * @returns The previous entry, or undefined when the model is new.
     */
    const previousModel = (models: ModelInfo[], modelId: string): ModelInfo | undefined =>
      models.find((model) => model.modelId === modelId);

    const engine = useEngineStore.subscribe((state, previous) => {
      let reported = false;

      for (const model of state.models) {
        const before = previousModel(previous.models, model.modelId);
        if (before === undefined) {
          continue;
        }

        if (model.error !== before.error && model.error !== '') {
          notify({
            severity: 'error',
            titleKey: 'common:notifications.downloadFailed',
            messageKey: `errors:${model.error}`,
            values: { name: model.name },
          });
          reported = true;
          continue;
        }

        // A transfer that stopped running, left no reason code, and left the
        // weights on disk is one that finished. Cancelling clears `downloading`
        // as well, which is why `cached` is part of the test rather than just
        // the absence of an error.
        if (before.downloading && !model.downloading && model.cached && model.error === '') {
          notify({
            severity: 'success',
            messageKey: 'common:notifications.modelReady',
            values: { name: model.name },
          });
          reported = true;
        }
      }

      if (state.sidecar.error !== previous.sidecar.error && state.sidecar.error !== '') {
        notify({
          severity: 'error',
          titleKey: 'common:notifications.engineFailed',
          messageKey: `errors:${state.sidecar.error}`,
        });
        return;
      }

      if (!reported && state.error !== previous.error && state.error !== null) {
        notify({
          severity: 'error',
          titleKey: 'common:notifications.engineFailed',
          messageKey: `errors:${state.error}`,
        });
      }
    });

    const generation = useGenerationStore.subscribe((state, previous) => {
      if (state.error !== previous.error && state.error !== null) {
        notify({
          severity: 'error',
          titleKey: 'common:notifications.generationFailed',
          messageKey: `errors:${state.error}`,
        });
      }
    });

    const shell = useShellStore.subscribe((state, previous) => {
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

      // The startup probe. Worth saying once, because it decides whether local
      // generation is possible at all, and the settings screen is not where the
      // user is looking when the application opens.
      if (state.gpu !== null && state.gpu !== previous.gpu && !state.gpu.available) {
        notify({
          severity: 'warning',
          titleKey: 'common:notifications.gpuUnavailable',
          // Already fully qualified by Rust, as `gpu.driver_missing`. Every
          // reason code in this file is: the two sides agreed on the shape so
          // that the interface would never have to rebuild one.
          messageKey: `errors:${state.gpu.code}`,
        });
      }
    });

    return () => {
      engine();
      generation();
      shell();
    };
  }, []);
}
