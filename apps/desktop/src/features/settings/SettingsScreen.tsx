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
import { Select } from '@/components/ui/Select';
import { StorageCard } from '@/features/settings/StorageCard';
import McpCard from '@/features/settings/mcp/McpCard';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { THEMES, useShellStore, type Theme } from '@/stores/useShellStore';

const REPOSITORY = 'https://github.com/Afterhours-Studio/bitwright-sprite-engine';

/**
 * The settings screen: where data is kept, how the window looks, and what this
 * build is.
 *
 * Three cards, in the order a person reaches for them: the one decision that
 * costs something to get wrong, the two that apply the moment they are made,
 * and then the facts to quote in a bug report.
 */
export function SettingsScreen(): ReactElement {
  const { t, i18n } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const theme = useShellStore((state) => state.theme);
  const setTheme = useShellStore((state) => state.setTheme);
  const vibrancy = useShellStore((state) => state.vibrancy);
  const sidecar = useShellStore((state) => state.sidecar);
  const appVersion = useShellStore((state) => state.appVersion);

  const vibrancyReason = translateError(vibrancy.reason);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <header>
        <h1 className="text-base font-semibold text-fg-primary">{t('title')}</h1>
        <p className="text-xs text-fg-secondary">{t('subtitle')}</p>
      </header>

      <StorageCard />

      <McpCard />

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

          {/* Read separately from the application's own version. A frozen
              sidecar reporting an old number looked like the application being
              stale, and showing only one of the two is what kept that mismatch
              invisible. */}
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
