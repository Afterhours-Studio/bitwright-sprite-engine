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

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Overlay } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { EngineSelector } from '@/features/settings/EngineSelector';
import { ProvidersCard } from '@/features/settings/ProvidersCard';
import { RuntimeCard } from '@/features/settings/RuntimeCard';
import { StorageCard } from '@/features/settings/StorageCard';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { BYTES_PER_MB, formatBytes, type ByteUnits } from '@/lib/format';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { useEngineStore } from '@/stores/useEngineStore';
import { THEMES, useShellStore, type Theme } from '@/stores/useShellStore';
import type { ModelInfo } from '@/types/engine';

const REPOSITORY = 'https://github.com/Afterhours-Studio/bitwright-sprite-engine';

/** The settings screen: engine choice, models, appearance, and about. */
export function SettingsScreen(): ReactElement {
  const { t, i18n } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const models = useEngineStore((state) => state.models);
  const sidecar = useEngineStore((state) => state.sidecar);
  const theme = useShellStore((state) => state.theme);
  const setTheme = useShellStore((state) => state.setTheme);
  const vibrancy = useShellStore((state) => state.vibrancy);
  const appVersion = useShellStore((state) => state.appVersion);

  const vibrancyReason = translateError(vibrancy.reason);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <header>
        <h1 className="text-base font-semibold text-fg-primary">{t('title')}</h1>
        <p className="text-xs text-fg-secondary">{t('subtitle')}</p>
      </header>

      <Card title={t('engine.title')} description={t('engine.description')}>
        <EngineSelector />
      </Card>

      {/* After the engine and before the models: choosing the remote API is
          part of choosing an engine, and it decides which models matter. */}
      {/* Directly under the engine choice: installing this is what makes the
          local engines selectable, and the remote API is the fallback while
          it is not. */}
      <RuntimeCard />

      <ProvidersCard />

      <Card title={t('models.title')} description={t('models.description')}>
        <ul className="flex flex-col gap-2">
          {models.map((model) => (
            <ModelRow key={model.modelId} model={model} />
          ))}
        </ul>
      </Card>

      {/* Between the models and the appearance: where the weights are kept
          is a fact about the models above it, not about the window. */}
      <StorageCard />

      <Card title={t('appearance.title')} description={t('appearance.description')}>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={tCommon('theme.label')}
            value={theme}
            options={THEMES.map((option) => ({
              value: option,
              label: tCommon(`theme.${option}`),
            }))}
            onValueChange={(value) => {
              setTheme(value as Theme);
            }}
          />
          <Select
            label={tCommon('language.label')}
            value={i18n.language}
            options={LANGUAGES.map((language) => ({
              value: language,
              label: tCommon(`language.${language}`),
              tag: language.toUpperCase(),
            }))}
            onValueChange={(value) => {
              void setLanguage(value as Language);
            }}
          />
        </div>
        <p className="mt-3 text-xs text-fg-secondary">
          {t('appearance.vibrancy')}
          {': '}
          {vibrancy.applied
            ? t('appearance.vibrancyOn')
            : (vibrancyReason ?? t('appearance.vibrancyOff'))}
        </p>
      </Card>

      <Card title={t('about.title')}>
        {/* A two column grid, so the values line up with each other. Laying
            each row out as its own flex line puts the value wherever that
            row's label happens to end, and three labels of different lengths
            then read as three ragged gaps. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs text-fg-secondary">
          <dt>{t('about.appVersion')}</dt>
          <dd className="text-fg-primary">{appVersion === '' ? '-' : appVersion}</dd>

          <dt>{t('about.engineVersion')}</dt>
          <dd className="text-fg-primary">{sidecar.version === '' ? '-' : sidecar.version}</dd>

          <dt>{t('about.repository')}</dt>
          <dd className="truncate text-fg-primary">{REPOSITORY}</dd>
        </dl>
        <p className="mt-2 text-xs text-fg-secondary">{t('about.license')}</p>
        <p className="text-xs text-fg-secondary">{t('about.copyright')}</p>
      </Card>
    </div>
  );
}

interface ModelRowProps {
  /** The registry entry this row describes. */
  model: ModelInfo;
}

/** Which confirmation the row's single popover is currently asking. */
type Confirmation = 'licence' | 'stop' | 'discard';

/** The words one confirmation puts in that popover. */
interface ConfirmationText {
  title: string;
  body: string;
  action: string;
}

/**
 * One model, with its state and its actions.
 *
 * Everything reads as a single left aligned block: the name, then the state
 * beside it, then the licence and the size, then whatever the user can do about
 * it. The previous version put the state and the button in a right hand column,
 * which on a wide card left a band of empty space between a model's name and
 * the button belonging to it, and made the pair look like it belonged to some
 * other row. Nothing here is pushed to the far edge.
 *
 * The row has three working states, and each offers its own pair of actions:
 *
 * - Nothing downloaded: Download, behind the licence confirmation. The weights
 *   are gigabytes and they arrive under a licence that is not this
 *   application's, so MODELS.md requires the licence to be in front of the
 *   user before anything is fetched.
 * - Downloading: the bar, then Pause and Stop. Pause keeps the bytes and Stop
 *   deletes them, and showing both is the point: they are two different
 *   intentions that used to share one button.
 * - Partially downloaded and not running: how far it got, as a percentage and
 *   as byte figures, then Resume and Discard. Resume does not ask about the
 *   licence again; the user accepted it for this model when they started.
 *
 * Nothing about the paused state is remembered here. The engine reports it
 * from what is on disk, so closing the application and reopening it finds the
 * same row, which is the entire reason resuming is worth having.
 *
 * Stop and Discard both throw gigabytes away, so both confirm. Pause destroys
 * nothing and acts on the first press. All three confirmations share one
 * Overlay, dismissed by the shared hook: a second popover written here would
 * be a second popover to keep in step with every other one in the interface.
 */
function ModelRow({ model }: ModelRowProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const download = useEngineStore((state) => state.download);
  const cancel = useEngineStore((state) => state.cancel);
  const pause = useEngineStore((state) => state.pause);

  const anchor = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const close = useCallback(() => {
    setConfirming(null);
  }, []);
  useDismiss(confirming !== null, anchor, close);

  const accept = useCallback(() => {
    const asking = confirming;
    close();
    if (asking === 'licence') {
      void download(model.modelId);
    } else if (asking !== null) {
      // Stopping and discarding are one operation to the engine: drop the
      // bytes. They are two confirmations because the sentence the user has to
      // read is different when a transfer is still running.
      void cancel(model.modelId);
    }
  }, [cancel, close, confirming, download, model.modelId]);

  const units: ByteUnits = {
    megabytes: tCommon('units.megabytes'),
    gigabytes: tCommon('units.gigabytes'),
  };

  // Paused is derived, never stored: bytes on disk that no transfer is moving.
  // Only the engine can see the cache, so only the engine decides it.
  const paused = !model.cached && !model.downloading && model.resumable;
  const pending = !model.cached && !model.downloading && !model.resumable;

  // Not every host announces a length. Falling back to the registry's estimate
  // keeps the bar and the byte figures sensible when one does not.
  const total = model.totalBytes > 0 ? model.totalBytes : model.sizeMb * BYTES_PER_MB;
  const measured = total > 0 ? model.downloadedBytes / total : 0;
  // The engine reports a fraction. It is clamped rather than trusted, because
  // a bar wider than its track escapes the row it belongs to.
  const fraction = model.progress > 0 ? model.progress : measured;
  const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  const transferred = t('models.transferred', {
    done: formatBytes(model.downloadedBytes, units),
    total: formatBytes(total, units),
  });

  const failure = translateError(model.error);

  let state = t('models.notCached');
  if (model.cached) {
    state = t('models.cached');
  } else if (model.downloading) {
    state = t('models.downloading');
  } else if (paused) {
    state = t('models.paused');
  }

  const licence = model.commercialUse ? t('models.commercialYes') : t('models.commercialNo');

  const confirmations: Record<Confirmation, ConfirmationText> = {
    licence: {
      title: t('models.confirmTitle'),
      body: t('models.confirmBody'),
      action: t('models.confirmAction'),
    },
    stop: {
      title: t('models.stopTitle'),
      body: t('models.stopBody'),
      action: t('models.stopAction'),
    },
    discard: {
      title: t('models.discardTitle'),
      body: t('models.discardBody'),
      action: t('models.discardAction'),
    },
  };
  const asked = confirming === null ? null : confirmations[confirming];

  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-surface-content-alt p-3">
      {/* Two columns, both anchored to the top. The model describes itself down
          the left; its state and the controls that act on it stay together at
          the right edge. Anchoring to the top rather than centring is what
          removes the band of empty rows that used to sit between the name and
          the button acting on it. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-fg-primary">{model.name}</span>
          {/* What the file is for, in the words the generate screen uses. The
              two screens named the same download differently, so nothing
              connected the row that fetches a style adapter to the control
              that selects one. */}
          <p className="text-xs text-fg-secondary">{t(`models.kind.${model.kind}`)}</p>
          <p className="text-xs text-fg-secondary">
            {t('models.license')}
            {': '}
            {model.licenseId}
            {' - '}
            {licence}
          </p>
          <p className="text-xs text-fg-secondary">
            {t('models.size')}
            {': '}
            {model.sizeMb} {tCommon('units.megabytes')}
          </p>
          {failure !== null && <p className="text-xs text-fg-secondary">{failure}</p>}
        </div>

        <div ref={anchor} className="relative flex shrink-0 flex-col items-end gap-2">
          <span className="text-xs text-fg-secondary">{state}</span>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {model.downloading && (
              <>
                {/* Pause keeps every byte, so it acts on the first press. A
                    confirmation in front of a control that destroys nothing is
                    a press the user spends to change nothing. */}
                <Button
                  variant="secondary"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    void pause(model.modelId);
                  }}
                >
                  {t('models.pauseDownload')}
                </Button>
                <Button
                  variant="ghost"
                  className="px-3 py-1 text-xs"
                  aria-haspopup="dialog"
                  aria-expanded={confirming === 'stop'}
                  onClick={() => {
                    setConfirming((was) => (was === 'stop' ? null : 'stop'));
                  }}
                >
                  {t('models.cancelDownload')}
                </Button>
              </>
            )}

            {paused && (
              <>
                {/* No licence confirmation. It was accepted for this model when
                    the download started, and asking again for the same weights
                    teaches the user to dismiss the question without reading. */}
                <Button
                  variant="secondary"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    void download(model.modelId);
                  }}
                >
                  {t('models.resumeDownload')}
                </Button>
                <Button
                  variant="ghost"
                  className="px-3 py-1 text-xs"
                  aria-haspopup="dialog"
                  aria-expanded={confirming === 'discard'}
                  onClick={() => {
                    setConfirming((was) => (was === 'discard' ? null : 'discard'));
                  }}
                >
                  {t('models.discardDownload')}
                </Button>
              </>
            )}

            {pending && (
              <Button
                variant="secondary"
                className="px-3 py-1 text-xs"
                aria-haspopup="dialog"
                aria-expanded={confirming === 'licence'}
                onClick={() => {
                  setConfirming((was) => (was === 'licence' ? null : 'licence'));
                }}
              >
                {failure === null ? t('models.download') : tCommon('actions.retry')}
              </Button>
            )}
          </div>

          {/* Hung from the right edge through the component's own `align`,
              because the anchor sits against the right edge of the card and a
              panel opening outwards would leave it. Passing a `right-0` class
              instead does not work: the default alignment already sets
              `start-0`, `cn` joins rather than merges so both survive, and an
              absolutely positioned box with a left, a right and a width is
              over-constrained - the left wins, and the panel hangs 288px past
              the edge of the screen. */}
          <Overlay open={asked !== null} align="end" className="w-72 p-3">
            {asked !== null && (
              <div
                role="dialog"
                aria-label={asked.title}
                className="flex flex-col gap-2 text-start"
              >
                <p className="text-sm font-medium text-fg-primary">{asked.title}</p>
                <p className="text-xs text-fg-secondary">{asked.body}</p>
                {confirming === 'licence' ? (
                  <>
                    <p className="text-xs text-fg-secondary">
                      {t('models.license')}
                      {': '}
                      {model.licenseId}
                      {' - '}
                      {licence}
                    </p>
                    <p className="text-xs text-fg-secondary">
                      {t('models.size')}
                      {': '}
                      {model.sizeMb} {tCommon('units.megabytes')}
                    </p>
                  </>
                ) : (
                  // What is about to be deleted, in the figures the user reads
                  // it in. "Gigabytes" in the abstract is not a quantity.
                  model.downloadedBytes > 0 && (
                    <p className="text-xs text-fg-secondary">{transferred}</p>
                  )
                )}
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Button variant="ghost" className="px-3 py-1 text-xs" onClick={close}>
                    {tCommon('actions.cancel')}
                  </Button>
                  <Button variant="primary" className="px-3 py-1 text-xs" onClick={accept}>
                    {asked.action}
                  </Button>
                </div>
              </div>
            )}
          </Overlay>
        </div>
      </div>

      {/* The bar spans the whole row rather than sitting in the right column:
          progress is about the model, and a 160px bar squeezed under a button
          reads as a decoration rather than as the state of a 4 GB transfer. It
          stays visible while paused, because a paused download showing no bar
          would look exactly like one that had never started. */}
      {(model.downloading || paused) && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={model.downloading ? t('models.downloading') : t('models.paused')}
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
            {t('models.progress', { percent })}
            {/* A percentage alone is not the figure a person wants when the
                file is four gigabytes. "2.9 GB of 4.0 GB" is. */}
            {model.downloadedBytes > 0 && ` - ${transferred}`}
          </span>
        </div>
      )}
    </li>
  );
}
