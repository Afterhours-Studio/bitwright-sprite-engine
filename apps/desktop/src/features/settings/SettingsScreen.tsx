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

import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { EngineSelector } from '@/features/settings/EngineSelector';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { useEngineStore } from '@/stores/useEngineStore';
import { useShellStore, type Theme } from '@/stores/useShellStore';

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

      <Card title={t('models.title')} description={t('models.description')}>
        <ul className="flex flex-col gap-2">
          {models.map((model) => (
            <li
              key={model.modelId}
              className="flex flex-col gap-1 rounded-sm border border-line-subtle bg-surface-sunken p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-fg-primary">{model.name}</span>
                <span className="text-xs text-fg-secondary">
                  {model.cached ? t('models.cached') : t('models.notCached')}
                </span>
              </div>
              <p className="text-xs text-fg-secondary">
                {t('models.license')}
                {': '}
                {model.licenseId}
                {' - '}
                {model.commercialUse ? t('models.commercialYes') : t('models.commercialNo')}
              </p>
              <p className="text-xs text-fg-secondary">
                {t('models.size')}
                {': '}
                {model.sizeMb} {tCommon('units.megabytes')}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('appearance.title')} description={t('appearance.description')}>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={tCommon('theme.label')}
            value={theme}
            options={[
              { value: 'dark', label: tCommon('theme.dark') },
              { value: 'light', label: tCommon('theme.light') },
            ]}
            onValueChange={(value) => {
              setTheme(value as Theme);
            }}
          />
          <SelectField
            label={tCommon('language.label')}
            value={i18n.language}
            options={LANGUAGES.map((language) => ({
              value: language,
              label: tCommon(`language.${language}`),
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
        <dl className="flex flex-col gap-1 text-xs text-fg-secondary">
          <div className="flex gap-2">
            <dt>{t('about.engineVersion')}</dt>
            <dd className="text-fg-primary">{sidecar.version === '' ? '-' : sidecar.version}</dd>
          </div>
          <div className="flex gap-2">
            <dt>{t('about.repository')}</dt>
            <dd className="text-fg-primary">{REPOSITORY}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-fg-secondary">{t('about.license')}</p>
        <p className="text-xs text-fg-secondary">{t('about.copyright')}</p>
      </Card>
    </div>
  );
}
