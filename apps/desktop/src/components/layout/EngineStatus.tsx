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
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Overlay } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { selectedBackend, useEngineStore } from '@/stores/useEngineStore';

/**
 * The engine indicator in the title bar.
 *
 * This used to be text in a bar along the bottom of every screen, which spent
 * permanent vertical space on something that is glanced at and then acted on
 * somewhere else. As a control in the chrome it reports the same thing and also
 * switches engine, which is what a user wants the moment they read it.
 */
export function EngineStatus(): ReactElement {
  const { t } = useTranslation();
  const { t: tSettings } = useTranslation('settings');
  const translateError = useErrorMessage();

  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  const sidecar = useEngineStore((state) => state.sidecar);
  const backends = useEngineStore((state) => state.backends);
  const select = useEngineStore((state) => state.select);
  const loading = useEngineStore((state) => state.loading);

  const backend = selectedBackend(backends);
  const ready = sidecar.ready && (backend?.available ?? false);
  const label = !sidecar.ready
    ? t('status.starting')
    : backend === null
      ? t('status.offline')
      : tSettings(`engine.${backend.kind}`);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('status.backend')}
        onClick={() => {
          setOpen((was) => !was);
        }}
        className={cn(
          // h-9 is the icon button's height, not a value of its own. This
          // control sits in a row of them, and a pill sized by its padding
          // came out a few pixels short, which reads as a misaligned row
          // rather than as a smaller control. The horizontal padding grew with
          // it, because px-3 on a 36px pill leaves the label looking wedged in.
          'inline-flex h-9 items-center gap-2 rounded-pill px-4',
          'border border-line-subtle text-xs font-medium transition-colors',
          open ? 'bg-surface-content-alt' : 'bg-surface-content shadow-sm',
          'text-fg-secondary hover:text-fg-primary',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('h-2 w-2 shrink-0 rounded-full', ready ? 'bg-accent' : 'bg-fg-muted')}
        />
        <span className="max-w-40 truncate">{label}</span>
      </button>

      <Overlay open={open} align="end" className="w-72">
        <ul role="listbox" aria-label={t('status.backend')}>
          {backends.map((entry) => {
            const reason = translateError(entry.detail);
            return (
              <li key={entry.kind}>
                <button
                  type="button"
                  role="option"
                  aria-selected={entry.selected}
                  disabled={!entry.available || loading}
                  onClick={() => {
                    void select(entry.kind);
                    close();
                  }}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-sm px-3 py-2 text-left transition-colors',
                    !entry.available && 'cursor-not-allowed',
                    entry.available && 'hover:bg-surface-content-alt',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        entry.available ? 'bg-accent' : 'bg-fg-muted',
                      )}
                    />
                    <span
                      className={cn(
                        'text-sm',
                        entry.available ? 'text-fg-primary' : 'text-fg-muted',
                      )}
                    >
                      {tSettings(`engine.${entry.kind}`)}
                    </span>
                    {entry.selected && (
                      <span className="ms-auto text-xs text-fg-secondary">
                        {tSettings('engine.selected')}
                      </span>
                    )}
                  </span>
                  {!entry.available && reason !== null && (
                    <span className="text-xs text-fg-secondary">{reason}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Overlay>
    </div>
  );
}
