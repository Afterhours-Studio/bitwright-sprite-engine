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
import { StorageCard } from '@/features/settings/StorageCard';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
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

/**
 * One model, with its state and its action.
 *
 * Everything reads as a single left aligned block: the name, then the state
 * beside it, then the licence and the size, then whatever the user can do about
 * it. The previous version put the state and the button in a right hand column,
 * which on a wide card left a band of empty space between a model's name and
 * the button belonging to it, and made the pair look like it belonged to some
 * other row. Nothing here is pushed to the far edge.
 *
 * Download opens a confirmation rather than starting the transfer. The weights
 * are gigabytes, and they arrive under a licence that is not this application's,
 * so MODELS.md requires the licence to be in front of the user before anything
 * is fetched. The confirmation is the shared Overlay, dismissed by the shared
 * hook, so it behaves like every other popover in the interface.
 */
function ModelRow({ model }: ModelRowProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const download = useEngineStore((state) => state.download);
  const cancel = useEngineStore((state) => state.cancel);

  const anchor = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const close = useCallback(() => {
    setConfirming(false);
  }, []);
  useDismiss(confirming, anchor, close);

  // The engine reports a fraction. It is clamped rather than trusted, because
  // a bar wider than its track escapes the row it belongs to.
  const percent = Math.round(Math.min(Math.max(model.progress, 0), 1) * 100);
  const failure = translateError(model.error);

  let state = model.cached ? t('models.cached') : t('models.notCached');
  if (model.downloading) {
    state = t('models.downloading');
  }

  const licence = model.commercialUse ? t('models.commercialYes') : t('models.commercialNo');

  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-surface-content-alt p-3">
      {/* Two columns, both anchored to the top. The model describes itself down
          the left; its state and the control that acts on it stay together at
          the right edge. Anchoring to the top rather than centring is what
          removes the band of empty rows that used to sit between the name and
          the button acting on it. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-fg-primary">{model.name}</span>
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

          {model.downloading && (
            <Button
              variant="ghost"
              className="px-3 py-1 text-xs"
              onClick={() => {
                void cancel(model.modelId);
              }}
            >
              {t('models.cancelDownload')}
            </Button>
          )}

          {!model.cached && !model.downloading && (
            <Button
              variant="secondary"
              className="px-3 py-1 text-xs"
              aria-haspopup="dialog"
              aria-expanded={confirming}
              onClick={() => {
                setConfirming((was) => !was);
              }}
            >
              {failure === null ? t('models.download') : tCommon('actions.retry')}
            </Button>
          )}

          {/* Hung from the right edge through the component's own `align`,
              because the anchor sits against the right edge of the card and a
              panel opening outwards would leave it. Passing a `right-0` class
              instead does not work: the default alignment already sets
              `start-0`, the two land in different tailwind-merge groups so both
              survive, and an absolutely positioned box with a left, a right and
              a width is over-constrained - the left wins, and the panel hangs
              288px past the edge of the screen. */}
          <Overlay open={confirming} align="end" className="w-72 p-3">
            <div
              role="dialog"
              aria-label={t('models.confirmTitle')}
              className="flex flex-col gap-2 text-start"
            >
              <p className="text-sm font-medium text-fg-primary">{t('models.confirmTitle')}</p>
              <p className="text-xs text-fg-secondary">{t('models.confirmBody')}</p>
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
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="ghost" className="px-3 py-1 text-xs" onClick={close}>
                  {tCommon('actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    close();
                    void download(model.modelId);
                  }}
                >
                  {t('models.confirmAction')}
                </Button>
              </div>
            </div>
          </Overlay>
        </div>
      </div>

      {/* The bar spans the whole row rather than sitting in the right column:
          progress is about the model, and a 160px bar squeezed under a button
          reads as a decoration rather than as the state of a 4 GB transfer. */}
      {model.downloading && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={t('models.downloading')}
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
          </span>
        </div>
      )}
    </li>
  );
}
