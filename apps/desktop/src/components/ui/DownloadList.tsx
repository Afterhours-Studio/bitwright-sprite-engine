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
 * What is downloading, and what has finished.
 *
 * Transfers in flight are read from the stores that own them rather than
 * copied: the model list and the runtime state already track them, and a
 * second copy of a moving number is how two parts of one screen come to
 * disagree. Only the record of finished transfers is kept, because nothing
 * else remembers those once they end.
 *
 * Content, not a panel: no surface, border or positioning of its own, so the
 * caller decides where it sits.
 */

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { BYTES_PER_MB, formatBytes, type ByteUnits } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useDownloadStore } from '@/stores/useDownloadStore';
import { useEngineStore } from '@/stores/useEngineStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';

/** One line, whether it is moving or finished. */
interface Row {
  id: string;
  name: string;
  /** Translated state, such as a percentage or how it ended. */
  state: string;
  /** Progress from zero to one, or null when the row is not moving. */
  progress: number | null;
  /** True when it ended badly, which is the only thing coloured differently. */
  failed: boolean;
}

/**
 * The list.
 *
 * @param props.className - Layout only, never colour.
 * @returns The rows, or a line saying there is nothing to show.
 */
export function DownloadList({ className }: { className?: string }): ReactElement {
  const { t } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const translateError = useErrorMessage();

  const models = useEngineStore((state) => state.models);
  const runtime = useRuntimeStore((state) => state.info);
  const history = useDownloadStore((state) => state.history);
  const clear = useDownloadStore((state) => state.clear);

  const units: ByteUnits = {
    megabytes: t('units.megabytes'),
    gigabytes: t('units.gigabytes'),
  };

  const active: Row[] = [];

  for (const model of models) {
    if (!model.downloading) {
      continue;
    }
    // Not every host announces a length, so the registry's estimate stands in
    // rather than leaving the bar at zero for four gigabytes.
    const total = model.totalBytes > 0 ? model.totalBytes : model.sizeMb * BYTES_PER_MB;
    const fraction =
      model.progress > 0 ? model.progress : total > 0 ? model.downloadedBytes / total : 0;
    active.push({
      id: `model-${model.modelId}`,
      name: model.name,
      state: tSettings('models.transferred', {
        done: formatBytes(model.downloadedBytes, units),
        total: formatBytes(total, units),
      }),
      progress: Math.min(Math.max(fraction, 0), 1),
      failed: false,
    });
  }

  if (runtime !== null && runtime.installing) {
    active.push({
      id: 'runtime',
      name: tSettings('runtime.title'),
      state: tSettings(`runtime.phase.${runtime.phase === '' ? 'download' : runtime.phase}`, {
        defaultValue: '',
      }),
      progress: Math.min(Math.max(runtime.progress, 0), 1),
      failed: false,
    });
  }

  const finished: Row[] = history.map((entry) => ({
    id: entry.id,
    name: entry.name,
    state:
      entry.outcome === 'failed'
        ? (translateError(entry.error) ?? t('downloads.failed'))
        : t(`downloads.${entry.outcome}`),
    progress: null,
    failed: entry.outcome === 'failed',
  }));

  const rows = [...active, ...finished];

  return (
    <div className={cn('flex min-w-[280px] flex-col gap-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-fg-secondary">{t('downloads.title')}</h2>
        {history.length > 0 && (
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs"
            onClick={() => {
              clear();
            }}
          >
            {t('downloads.clear')}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-fg-secondary">{t('downloads.empty')}</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-3 overflow-auto">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-medium text-fg-primary">{row.name}</span>
                {row.progress !== null && (
                  <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
                    {Math.round(row.progress * 100)}%
                  </span>
                )}
              </div>
              {row.progress !== null && (
                <div className="h-1.5 overflow-hidden rounded-pill bg-surface-well">
                  {/* The width is the one thing here that cannot be a class: it
                      is a measured value, not a design decision. */}
                  <div
                    className="h-full rounded-pill bg-accent transition-[width] duration-150"
                    style={{ width: `${String(Math.round(row.progress * 100))}%` }}
                  />
                </div>
              )}
              <p className={cn('text-xs', row.failed ? 'text-fg-primary' : 'text-fg-secondary')}>
                {row.state}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
