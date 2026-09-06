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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Overlay } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useEngineStore } from '@/stores/useEngineStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import type { RuntimeInfo, RuntimePlan } from '@/types/engine';

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** The unit words, translated once and passed down rather than looked up twice. */
interface Units {
  megabytes: string;
  gigabytes: string;
}

/**
 * Renders a size the way a disk reports it.
 *
 * Gigabytes once a value reaches one, megabytes below that. The CUDA runtime is
 * measured in gigabytes, and a figure in megabytes with ten digits is a number
 * the reader has to count rather than read.
 *
 * @param bytes - The size to render.
 * @param units - Translated unit words.
 * @returns The size with its unit.
 */
function formatSize(bytes: number, units: Units): string {
  if (bytes >= BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_GB).toFixed(1)} ${units.gigabytes}`;
  }
  return `${Math.round(bytes / BYTES_PER_MB)} ${units.megabytes}`;
}

/**
 * Lists the distinct licences a plan's packages arrive under.
 *
 * Every package declares its own expression and several repeat, so the list is
 * deduplicated. It is shown before the download rather than after, which is the
 * same rule MODELS.md sets for weights.
 *
 * @param plan - The build being described.
 * @returns The licences, joined for display.
 */
function licencesOf(plan: RuntimePlan): string {
  const seen = new Set<string>();
  for (const item of plan.packages) {
    for (const part of item.licenseId.split(/\s+AND\s+|\s+OR\s+/)) {
      const trimmed = part.trim();
      if (trimmed !== '') {
        seen.add(trimmed);
      }
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right)).join(', ');
}

/**
 * The GPU runtime: PyTorch, and how to get it onto this machine.
 *
 * A working NVIDIA card, an application that wants it, and no PyTorch is the
 * state every user starts in, because PyTorch is two and a half gigabytes and
 * shipping it inside the installer is not reasonable. Until this card existed
 * there was no way out of that state without a terminal.
 *
 * Everything the decision needs is on screen before it is made: what would be
 * downloaded, how large the result is, how much room the chosen drive has, the
 * licences the pieces arrive under, and the fact that the engine has to be
 * restarted afterwards. Pressing the button opens a confirmation rather than
 * starting the download; so does removal, which deletes the same gigabytes.
 *
 * Reads the store directly, as the other cards on this screen do, so the screen
 * can mount it as `<RuntimeCard />` with nothing to wire up.
 *
 * @returns The runtime card.
 */
export function RuntimeCard(): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const info = useRuntimeStore((state) => state.info);
  const loading = useRuntimeStore((state) => state.loading);
  const error = useRuntimeStore((state) => state.error);
  const refresh = useRuntimeStore((state) => state.refresh);
  const install = useRuntimeStore((state) => state.install);
  const cancel = useRuntimeStore((state) => state.cancel);
  const repair = useRuntimeStore((state) => state.repair);
  const remove = useRuntimeStore((state) => state.remove);
  const stopPolling = useRuntimeStore((state) => state.stopPolling);

  // The runtime state comes from the engine, so there is nothing to ask for
  // until the engine is answering. Asking anyway would fill the card with
  // "the engine is still starting" every time the screen opens during startup.
  const engineReady = useEngineStore((state) => state.sidecar.ready);

  const units: Units = {
    megabytes: tCommon('units.megabytes'),
    gigabytes: tCommon('units.gigabytes'),
  };

  const anchor = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<RuntimePlan | null>(null);
  const [removing, setRemoving] = useState(false);

  const close = useCallback(() => {
    setPending(null);
    setRemoving(false);
  }, []);
  useDismiss(pending !== null || removing, anchor, close);

  useEffect(() => {
    if (engineReady) {
      void refresh();
    }
  }, [engineReady, refresh]);

  // The store polls the engine while an install runs. Leaving the screen must
  // stop that, or a settings screen the user closed keeps making requests.
  useEffect(() => stopPolling, [stopPolling]);

  const failure = translateError(error);
  const unknownSpace = t('runtime.unknownSpace');

  return (
    <Card title={t('runtime.title')} description={t('runtime.description')}>
      {/* What is on disk against what is pinned. A count of what is missing
          means nothing without the total it is missing from, and naming the
          packages is what turns "something is wrong" into a decision. */}
      {info !== null && info.installed && info.totalPackages > 0 && (
        <div className="mb-3 flex flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-fg-secondary">{t('runtime.packages')}</span>
            <span className="font-medium text-fg-primary">
              {t('runtime.packagesPresent', {
                count: info.totalPackages - info.missingPackages.length,
              })}
            </span>
            {info.missingPackages.length > 0 && (
              <span className="text-fg-secondary">
                {t('runtime.packagesMissing', { count: info.missingPackages.length })}
              </span>
            )}
          </p>
          {info.missingPackages.length === 0 ? (
            <p className="text-xs text-fg-secondary">{t('runtime.packagesComplete')}</p>
          ) : (
            !info.installing && (
              <p className="text-xs text-fg-secondary">
                {t('runtime.repairHint', { names: info.missingPackages.join(', ') })}{' '}
                {formatSize(info.missingBytes, units)}
              </p>
            )
          )}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <Summary info={info} units={units} unknownSpace={unknownSpace} />

        {info !== null && info.installing && <Progress info={info} />}

        <div ref={anchor} className="relative flex flex-wrap items-center gap-2">
          {info !== null && info.installing && (
            <Button
              variant="ghost"
              className="px-3 py-1 text-xs"
              onClick={() => {
                void cancel();
              }}
            >
              {t('runtime.stop')}
            </Button>
          )}

          {info !== null &&
            !info.installing &&
            !info.installed &&
            info.supported &&
            info.plans.map((plan) => (
              <Button
                key={plan.accelerator}
                variant={plan.accelerator === info.recommendedAccelerator ? 'primary' : 'secondary'}
                className="px-3 py-1 text-xs"
                disabled={loading || !engineReady}
                aria-haspopup="dialog"
                aria-expanded={pending?.accelerator === plan.accelerator}
                onClick={() => {
                  setRemoving(false);
                  setPending((was) => (was?.accelerator === plan.accelerator ? null : plan));
                }}
              >
                {t('runtime.installVariant', { build: buildName(plan, t) })}
              </Button>
            ))}

          {info !== null && !info.installing && info.installed && (
            <Button
              variant="ghost"
              className="px-3 py-1 text-xs"
              disabled={loading || !engineReady}
              aria-haspopup="dialog"
              aria-expanded={removing}
              onClick={() => {
                setPending(null);
                setRemoving((was) => !was);
              }}
            >
              {t('runtime.removeAction')}
            </Button>
          )}

          {/* Adding a package costs megabytes and destroys nothing, so unlike
              install and remove it does not ask first. Offered only when the
              tree is actually short of something. */}
          {info !== null &&
            info.installed &&
            !info.installing &&
            info.missingPackages.length > 0 && (
              <Button
                variant="secondary"
                className="px-3 py-1 text-xs"
                disabled={loading || !engineReady}
                onClick={() => {
                  void repair();
                }}
              >
                {t('runtime.repair')}
              </Button>
            )}

          {/* Hung from the start edge through the component's own `align`,
              because the buttons sit against the start edge of the card. A
              `right-0` class instead would land beside the default `start-0`,
              both would survive the join, and a box with a left, a right and a
              width is over-constrained. */}
          <Overlay open={pending !== null || removing} className="w-80 p-3">
            {pending !== null && info !== null && (
              <InstallConfirmation
                plan={pending}
                info={info}
                units={units}
                busy={loading}
                onCancel={close}
                onConfirm={() => {
                  close();
                  void install(pending.accelerator);
                }}
              />
            )}
            {removing && info !== null && (
              <RemoveConfirmation
                info={info}
                units={units}
                busy={loading}
                onCancel={close}
                onConfirm={() => {
                  close();
                  void remove();
                }}
              />
            )}
          </Overlay>
        </div>

        {failure !== null && <p className="text-xs text-fg-secondary">{failure}</p>}
      </div>
    </Card>
  );
}

/** Translates a build into the name shown on its button and in its heading. */
type Translate = ReturnType<typeof useTranslation<'settings'>>['t'];

/**
 * Names one build the way a user reads it.
 *
 * @param plan - The build to name.
 * @param t - The settings translator.
 * @returns The build's name, with its CUDA version where it has one.
 */
function buildName(plan: RuntimePlan, t: Translate): string {
  const lookup = t as unknown as (key: string, values?: Record<string, string>) => string;
  return lookup(`runtime.accelerator.${plan.accelerator}`, { version: plan.cudaVersion });
}

interface SummaryProps {
  /** The runtime as the engine reported it, or null before it answered. */
  info: RuntimeInfo | null;
  /** Translated unit words. */
  units: Units;
  /** What to show where a volume could not be read. */
  unknownSpace: string;
}

/**
 * What is installed, where, and whether the GPU is actually usable.
 *
 * "Installed" and "working" are two different facts and are reported as two,
 * because a runtime on disk that the engine has not picked up yet is the normal
 * state between installing and restarting, and calling that working would be a
 * lie the user finds out about at their first generation.
 *
 * @param props - The runtime and the words to render it with.
 * @returns The summary block.
 */
function Summary({ info, units, unknownSpace }: SummaryProps): ReactElement {
  const { t } = useTranslation('settings');
  const translateError = useErrorMessage();

  let state = t('runtime.notInstalled');
  if (info?.installing === true) {
    state = t('runtime.installing');
  } else if (info?.installed === true) {
    state = t('runtime.installedLabel');
  }

  const probe = translateError(info?.probeDetail ?? '');

  return (
    <div className="rounded-md border border-line bg-surface-content-alt p-3">
      {/* One label-and-value pair per cell, two pairs to a row once there is
          room. Seven pairs in a single column left most of the card empty to
          the right while the list ran down past the controls; the label column
          stays `auto` inside each pair so values still line up with each
          other rather than starting wherever a label happens to end.
          The location is the exception: a path is long and unbreakable, so it
          takes the full width rather than forcing the column that holds it
          wide enough for every other value. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs text-fg-secondary md:grid-cols-[auto_1fr_auto_1fr]">
        <dt>{t('runtime.state')}</dt>
        <dd className="text-fg-primary">{state}</dd>

        <dt className="md:col-start-1">{t('runtime.location')}</dt>
        <dd className="break-all text-fg-primary md:col-span-3">
          {info === null ? '-' : info.installDir}
        </dd>

        <dt>{t('runtime.free')}</dt>
        <dd className="text-fg-primary">
          {info === null || info.freeBytes === null
            ? unknownSpace
            : formatSize(info.freeBytes, units)}
        </dd>

        <dt>{t('runtime.used')}</dt>
        <dd className="text-fg-primary">
          {info === null ? '-' : formatSize(info.usedBytes, units)}
        </dd>

        {info !== null && info.installed && (
          <>
            <dt>{t('runtime.torchVersion')}</dt>
            <dd className="text-fg-primary">
              {info.torchVersion === '' ? info.installedTorchVersion : info.torchVersion}
            </dd>
          </>
        )}

        {info !== null && info.device !== '' && (
          <>
            <dt>{t('runtime.device')}</dt>
            <dd className="text-fg-primary">{info.device}</dd>
          </>
        )}

        <dt>{t('runtime.target')}</dt>
        <dd className="text-fg-primary">{info === null ? '-' : info.target}</dd>
      </dl>

      {info !== null && info.restartRequired && (
        <p className="mt-2 text-xs text-fg-secondary">{t('runtime.restartRequired')}</p>
      )}

      {info !== null && info.cudaAvailable && (
        <p className="mt-2 text-xs text-fg-secondary">{t('runtime.cudaReady')}</p>
      )}

      {info !== null && info.mpsAvailable && (
        <p className="mt-2 text-xs text-fg-secondary">{t('runtime.mpsReady')}</p>
      )}

      {info !== null && info.torchImportable && !info.cudaAvailable && !info.mpsAvailable && (
        <p className="mt-2 text-xs text-fg-secondary">{t('runtime.noDevice')}</p>
      )}

      {info !== null && !info.supported && (
        <p className="mt-2 text-xs text-fg-secondary">{t('runtime.unsupported')}</p>
      )}

      {info !== null && info.installed && !info.torchImportable && probe !== null && (
        <p className="mt-2 text-xs text-fg-secondary">{probe}</p>
      )}
    </div>
  );
}

interface ProgressProps {
  /** The runtime, which is reporting an install in flight. */
  info: RuntimeInfo;
}

/**
 * How far the install has got, and what it is doing.
 *
 * The bar spans the whole card rather than sitting beside a button: progress is
 * about a two and a half gigabyte transfer, and a short bar squeezed under a
 * control reads as a decoration.
 *
 * @param props - The runtime reporting the install.
 * @returns The progress row.
 */
function Progress({ info }: ProgressProps): ReactElement {
  const { t } = useTranslation('settings');

  // The engine reports a fraction. It is clamped rather than trusted, because
  // a bar wider than its track escapes the row it belongs to.
  const percent = Math.round(Math.min(Math.max(info.progress, 0), 1) * 100);

  const lookup = t as unknown as (key: string) => string;
  const phase = info.phase === '' ? t('runtime.installing') : lookup(`runtime.phase.${info.phase}`);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-fg-secondary">{phase}</span>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={phase}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-well"
        >
          {/* The width is the one thing here that cannot be a class: it is a
              measured value, not a design decision. The colour still comes
              from a token. */}
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-150"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-fg-secondary">
          {t('runtime.progress', { percent })}
        </span>
      </div>
    </div>
  );
}

interface InstallConfirmationProps {
  /** The build awaiting confirmation. */
  plan: RuntimePlan;
  /** The runtime, for the free space on the target volume. */
  info: RuntimeInfo;
  /** Translated unit words. */
  units: Units;
  /** Whether a request is in flight, which disables the confirmation. */
  busy: boolean;
  /** Called when the user backs out. */
  onCancel: () => void;
  /** Called when the user confirms. */
  onConfirm: () => void;
}

/**
 * The confirmation shown before gigabytes start moving.
 *
 * It states the size both ways, the licences, and, for a CUDA build, that
 * NVIDIA's libraries come under NVIDIA's own agreement rather than an open
 * source one. That notice is the reason this is a confirmation rather than a
 * single press: the terms have to be in front of the user beforehand.
 *
 * @param props - The plan and its actions.
 * @returns The confirmation panel.
 */
function InstallConfirmation({
  plan,
  info,
  units,
  busy,
  onCancel,
  onConfirm,
}: InstallConfirmationProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();

  const free = info.freeBytes;
  const tooSmall = free !== null && free < plan.requiredBytes;

  return (
    <div
      role="dialog"
      aria-label={t('runtime.confirmTitle')}
      className="flex flex-col gap-2 text-start"
    >
      <p className="text-sm font-medium text-fg-primary">{t('runtime.confirmTitle')}</p>
      <p className="text-xs text-fg-primary">{buildName(plan, t)}</p>

      {plan.accelerator === info.recommendedAccelerator && (
        <p className="text-xs text-fg-secondary">{t('runtime.recommended')}</p>
      )}

      <p className="text-xs text-fg-secondary">
        {t('runtime.confirmBody', {
          download: formatSize(plan.downloadBytes, units),
          installed: formatSize(plan.installedBytes, units),
        })}
      </p>

      {/* Two columns, so the four sizes line up with each other and can be
          compared at a glance rather than read as four sentences. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-fg-secondary">
        <dt>{t('runtime.download')}</dt>
        <dd className="text-fg-primary">{formatSize(plan.downloadBytes, units)}</dd>

        <dt>{t('runtime.onDisk')}</dt>
        <dd className="text-fg-primary">{formatSize(plan.installedBytes, units)}</dd>

        <dt>{t('runtime.needsFree')}</dt>
        <dd className="text-fg-primary">{formatSize(plan.requiredBytes, units)}</dd>

        <dt>{t('runtime.free')}</dt>
        <dd className="text-fg-primary">
          {free === null ? t('runtime.unknownSpace') : formatSize(free, units)}
        </dd>
      </dl>

      {tooSmall && (
        <p className="text-xs text-fg-secondary">
          {t('runtime.lowSpace', { needed: formatSize(plan.requiredBytes, units) })}
        </p>
      )}

      {plan.accelerator === 'cpu' && (
        <p className="text-xs text-fg-secondary">{t('runtime.cpuNote')}</p>
      )}

      <p className="text-sm font-medium text-fg-primary">{t('runtime.licenseTitle')}</p>
      <p className="text-xs text-fg-secondary">
        {t('runtime.licenseBody', { licenses: licencesOf(plan) })}
      </p>
      <p className="break-all text-xs text-fg-secondary">
        {t('runtime.licenseLink')}
        {': '}
        {plan.torchLicenseUrl}
      </p>

      {plan.bundlesNvidia && (
        <>
          <p className="text-xs text-fg-secondary">{t('runtime.nvidiaNotice')}</p>
          <p className="break-all text-xs text-fg-secondary">
            {t('runtime.nvidiaLink')}
            {': '}
            {plan.cudaLicenseUrl}
          </p>
        </>
      )}

      <p className="text-xs text-fg-secondary">
        {t('runtime.packages')}
        {': '}
        {plan.packages.map((item) => `${item.name} ${item.version}`).join(', ')}
      </p>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button variant="primary" className="px-3 py-1 text-xs" disabled={busy} onClick={onConfirm}>
          {t('runtime.confirmAction')}
        </Button>
      </div>
    </div>
  );
}

interface RemoveConfirmationProps {
  /** The runtime being removed. */
  info: RuntimeInfo;
  /** Translated unit words. */
  units: Units;
  /** Whether a request is in flight, which disables the confirmation. */
  busy: boolean;
  /** Called when the user backs out. */
  onCancel: () => void;
  /** Called when the user confirms. */
  onConfirm: () => void;
}

/**
 * The confirmation shown before gigabytes are deleted.
 *
 * Deleting several gigabytes takes as much of a decision as downloading them,
 * and the download is the only way to get them back, so the size and the path
 * are both named here.
 *
 * @param props - The runtime and the actions.
 * @returns The confirmation panel.
 */
function RemoveConfirmation({
  info,
  units,
  busy,
  onCancel,
  onConfirm,
}: RemoveConfirmationProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();

  return (
    <div
      role="dialog"
      aria-label={t('runtime.removeTitle')}
      className="flex flex-col gap-2 text-start"
    >
      <p className="text-sm font-medium text-fg-primary">{t('runtime.removeTitle')}</p>
      <p className="break-all text-xs text-fg-secondary">
        {t('runtime.removeBody', {
          size: formatSize(info.usedBytes, units),
          path: info.installDir,
        })}
      </p>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button variant="primary" className="px-3 py-1 text-xs" disabled={busy} onClick={onConfirm}>
          {t('runtime.removeConfirm')}
        </Button>
      </div>
    </div>
  );
}
