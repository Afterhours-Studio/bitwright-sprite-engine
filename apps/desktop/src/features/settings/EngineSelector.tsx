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

import { StatusDot } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useEngineStore } from '@/stores/useEngineStore';
import type { BackendInfo } from '@/types/engine';

/**
 * The engine choice.
 *
 * Every engine is listed, available or not. An unavailable one is disabled and
 * shows the translated reason, so the user learns that they need a driver
 * rather than that the button does nothing. The reason is secondary text and is
 * held to 4.5:1, because it is the thing the user has to read in order to fix
 * the problem.
 *
 * Each row is a card nested inside the Engine card, so it uses the alt surface
 * and a full-strength border: in light mode both are near white, and the border
 * is what separates them.
 */
export function EngineSelector(): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tGeneration } = useTranslation('generation');
  const translateError = useErrorMessage();

  const backends = useEngineStore((state) => state.backends);
  const select = useEngineStore((state) => state.select);
  const loading = useEngineStore((state) => state.loading);

  return (
    <ul className="flex flex-col gap-3">
      {backends.map((backend: BackendInfo) => {
        const reason = translateError(backend.detail);
        return (
          <li
            key={backend.kind}
            className="flex flex-col gap-2 rounded-md border border-line bg-surface-content-alt p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <StatusDot
                tone={backend.available ? 'ready' : 'off'}
                label={backend.available ? t('engine.select') : t('engine.unavailable')}
              >
                <span className="whitespace-nowrap text-sm font-medium text-fg-primary">
                  {t(`engine.${backend.kind}`)}
                </span>
              </StatusDot>

              <Pill
                className="shrink-0"
                tone="anchor"
                active={backend.selected}
                disabled={!backend.available || loading}
                onClick={() => {
                  void select(backend.kind);
                }}
              >
                {backend.selected ? t('engine.selected') : t('engine.select')}
              </Pill>
            </div>

            {backend.available && backend.device !== '' && (
              <p className="text-xs text-fg-secondary">
                {t('engine.device')}
                {': '}
                {backend.device}
              </p>
            )}

            {!backend.available && reason !== null && (
              <p className="text-xs text-fg-secondary">{reason}</p>
            )}

            <p className="text-xs text-fg-secondary">
              {t('engine.capabilities')}
              {': '}
              {backend.capabilities.length === 0
                ? tGeneration('parameters.loraNone')
                : backend.capabilities
                    .map((capability) => {
                      switch (capability) {
                        case 'batch':
                          return tGeneration('capability.batch');
                        case 'lora_hotswap':
                          return tGeneration('capability.loraHotswap');
                        case 'controlnet':
                          return tGeneration('capability.controlnet');
                        case 'ip_adapter':
                          return tGeneration('capability.ipAdapter');
                      }
                    })
                    .join(', ')}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
