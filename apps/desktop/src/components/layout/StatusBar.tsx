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
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useErrorMessage } from '@/hooks/useErrorMessage';
import { selectedBackend, useEngineStore } from '@/stores/useEngineStore';
import { useGenerationStore } from '@/stores/useGenerationStore';

/**
 * The floating status pill along the bottom of the window.
 *
 * It uses the anchor surface, the one large dark area in light mode, and it
 * floats clear of the edges rather than spanning them. Without a dark anchor
 * the interface floats: every surface is light, and nothing gives the eye a
 * base to read the rest against.
 */
export function StatusBar(): ReactElement {
  const { t } = useTranslation();
  const { t: tSettings } = useTranslation('settings');
  const translateError = useErrorMessage();

  const sidecar = useEngineStore((state) => state.sidecar);
  const backends = useEngineStore((state) => state.backends);
  const engineError = useEngineStore((state) => state.error);
  const running = useGenerationStore((state) => state.running);
  const durationMs = useGenerationStore((state) => state.durationMs);

  const backend = selectedBackend(backends);
  const message = translateError(sidecar.error === '' ? engineError : sidecar.error);

  // "Ready" has to mean the engine can actually generate. Reporting it purely
  // from the sidecar being up would say Ready next to a backend whose driver is
  // missing, which is the opposite of what the user needs to know.
  const engineState = !sidecar.ready
    ? t('status.starting')
    : (backend?.available ?? false)
      ? t('status.ready')
      : t('status.offline');

  return (
    <footer className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <div className="pointer-events-auto flex max-w-[90%] items-center gap-4 rounded-pill bg-surface-anchor px-5 py-2 text-xs text-fg-on-anchor shadow-lg">
        <span className="whitespace-nowrap">
          {t('status.backend')}
          {': '}
          {backend === null ? t('status.offline') : tSettings(`engine.${backend.kind}`)}
        </span>

        <span aria-hidden="true" className="h-3 w-px bg-line-strong" />

        <span className="whitespace-nowrap">{engineState}</span>

        {running && <span className="whitespace-nowrap">{t('status.working')}</span>}

        {!running && durationMs > 0 && (
          <span className="whitespace-nowrap">
            {durationMs}
            {t('units.milliseconds')}
          </span>
        )}

        {message !== null && <span className="truncate">{message}</span>}
      </div>
    </footer>
  );
}
