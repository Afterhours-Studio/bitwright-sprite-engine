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
 * The dark bar along the bottom of the window.
 *
 * It uses the anchor token, the one large dark area in light mode. Without it
 * the interface floats: every surface is light, and nothing gives the eye a
 * base to read the elevation against.
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
    <footer className="flex h-statusbar shrink-0 items-center justify-between gap-4 bg-anchor px-4 text-xs text-anchor-fg">
      <div className="flex items-center gap-4">
        <span>
          {t('status.backend')}
          {': '}
          {backend === null ? t('status.offline') : tSettings(`engine.${backend.kind}`)}
        </span>
        {backend !== null && backend.device !== '' && (
          <span className="truncate">{backend.device}</span>
        )}
        <span>{engineState}</span>
      </div>

      <div className="flex items-center gap-4">
        {running && <span>{t('status.working')}</span>}
        {!running && durationMs > 0 && (
          <span>
            {durationMs}
            {t('units.milliseconds')}
          </span>
        )}
        {message !== null && <span className="truncate">{message}</span>}
      </div>
    </footer>
  );
}
