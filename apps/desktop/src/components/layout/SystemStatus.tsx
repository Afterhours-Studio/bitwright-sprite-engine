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
 * What this machine can run, and what is missing from it.
 *
 * Every fact here already existed in a store and none of it was on screen. An
 * application with a working GPU in front of it therefore reported nothing at
 * all, and the reason generation was unavailable - PyTorch not being installed
 * - could only be found by reading a log. Nobody should have to be told by
 * someone else which piece their machine is missing.
 *
 * The face carries a ready count so a problem is visible without opening
 * anything, and the panel names every part with the reason and the remedy when
 * it is not ready.
 */

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { useEngineStore } from '@/stores/useEngineStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { useShellStore } from '@/stores/useShellStore';

/** How a part reads: it counts towards readiness, or it is context. */
type Tone = 'ready' | 'missing' | 'plain';

/** One line of the report. */
interface Part {
  /** Stable key. */
  id: string;
  /** Row label. */
  label: string;
  /** Short state, or the value for a context row. */
  value: string;
  /** Why it is not ready, and what to do. Absent when it is. */
  hint?: string | undefined;
  /** Whether it counts, and how it is coloured. */
  tone: Tone;
}

/**
 * Collects every part, in the order a failure has to be read.
 *
 * The engine first, because nothing else can be true without it; then the
 * hardware; then the runtime that turns hardware into a usable backend; then
 * the backends; then the weights they would load. A reader going down the list
 * meets the cause before the symptom.
 *
 * @returns The parts, and how many of the ones that count are ready.
 */
function useParts(): { parts: Part[]; ready: number; counted: number } {
  const { t } = useTranslation('generation');
  const { t: tError } = useTranslation('errors');

  const platform = useShellStore((state) => state.platform);
  const gpu = useShellStore((state) => state.gpu);
  const sidecar = useEngineStore((state) => state.sidecar);
  const backends = useEngineStore((state) => state.backends);
  const models = useEngineStore((state) => state.models);
  const runtime = useRuntimeStore((state) => state.info);

  /** Translates a reason code, and says nothing when there is none. */
  const describe = (code: string): string | undefined =>
    code === '' ? undefined : tError(code, { defaultValue: tError('unknown') });

  const parts: Part[] = [];

  if (platform !== null) {
    parts.push({
      id: 'machine',
      label: t('binaries.machine'),
      value: t(`binaries.os.${platform.os}`),
      tone: 'plain',
    });
  }

  parts.push({
    id: 'engine',
    label: t('binaries.engine'),
    value: sidecar.ready ? sidecar.version : t('binaries.stopped'),
    ...(sidecar.ready ? {} : { hint: describe(sidecar.error) }),
    tone: sidecar.ready ? 'ready' : 'missing',
  });

  if (gpu !== null) {
    parts.push({
      id: 'gpu',
      label: t('binaries.gpu'),
      value: gpu.available ? gpu.detail : t('binaries.none'),
      ...(gpu.available ? {} : { hint: describe(gpu.code) }),
      tone: gpu.available ? 'ready' : 'missing',
    });
  }

  if (runtime !== null) {
    // Installed and usable are two facts. Conflating them is how a problem
    // that needs a restart gets mistaken for a broken install.
    const usable = runtime.installed && runtime.torchImportable;
    const value = runtime.installed
      ? usable
        ? runtime.installedTorchVersion
        : t('binaries.restart')
      : t('binaries.notInstalled');
    parts.push({
      id: 'runtime',
      label: t('binaries.runtime'),
      value,
      ...(usable ? {} : { hint: t('binaries.runtimeHint') }),
      tone: usable ? 'ready' : 'missing',
    });
  }

  for (const backend of backends) {
    parts.push({
      id: `backend-${backend.kind}`,
      label: t(`binaries.backend.${backend.kind}`),
      value: backend.available ? backend.device : t('binaries.unavailable'),
      // No reason here. Every backend that is not the one in use carries one,
      // and three sentences among nine one-line facts is a paragraph pretending
      // to be a table. Settings names the reason, on the control that acts on
      // it.
      tone: backend.available ? 'ready' : 'missing',
    });
  }

  if (models.length > 0) {
    const cached = models.filter((model) => model.cached).length;
    parts.push({
      id: 'models',
      label: t('binaries.models'),
      value: t('binaries.modelCount', { cached, total: models.length }),
      ...(cached === 0 ? { hint: t('binaries.modelsHint') } : {}),
      tone: cached === 0 ? 'missing' : 'ready',
    });
  }

  const counted = parts.filter((part) => part.tone !== 'plain');
  return {
    parts,
    ready: counted.filter((part) => part.tone === 'ready').length,
    counted: counted.length,
  };
}

/**
 * The pill face: a name and how much of this machine is ready.
 *
 * @returns The face.
 */
export function SystemStatusFace(): ReactElement {
  const { t } = useTranslation('generation');
  const { ready, counted } = useParts();

  return (
    <span className="flex items-center gap-2">
      <span>{t('binaries.title')}</span>
      {counted > 0 && (
        <span
          className={cn(
            'tabular-nums',
            ready === counted ? 'text-fg-primary' : 'text-fg-secondary',
          )}
        >
          {ready}/{counted}
        </span>
      )}
    </span>
  );
}

/**
 * The panel: every part, with the reason and the remedy when one is missing.
 *
 * @returns The report.
 */
export function SystemStatusPanel(): ReactElement {
  const { t } = useTranslation('generation');
  const { parts } = useParts();

  if (parts.length === 0) {
    return <p className="text-sm text-fg-secondary">{t('binaries.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part) => (
        <div key={part.id} className="flex flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-xs text-fg-secondary">{part.label}</span>
            <span
              className={cn(
                'truncate text-xs font-medium',
                part.tone === 'missing' ? 'text-fg-secondary' : 'text-fg-primary',
              )}
            >
              {part.value}
            </span>
          </div>
          {part.hint !== undefined && <p className="text-xs text-fg-secondary">{part.hint}</p>}
        </div>
      ))}
    </div>
  );
}
