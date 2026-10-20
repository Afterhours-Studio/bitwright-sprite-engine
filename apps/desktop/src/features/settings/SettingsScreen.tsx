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

import { WindowControls } from '@/components/layout/WindowControls';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { HomeSidebar, type HomeView } from '@/features/home/HomeSidebar';
import { StorageCard } from '@/features/settings/StorageCard';
import McpCard from '@/features/settings/mcp/McpCard';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { THEMES, useShellStore } from '@/stores/useShellStore';

const REPOSITORY = 'https://github.com/Afterhours-Studio/bitwright-sprite-engine';

/**
 * The settings screen, in home's frame: the same sidebar with Settings
 * active, and a content area styled like home's.
 *
 * Two columns: where data is kept, the theme and language, and the facts to
 * quote in a bug report on the left; the agent connection, the tallest group,
 * on the right.
 *
 * The sidebar's Projects entry goes home; its Settings entry is already here.
 */
export function SettingsScreen(): ReactElement {
  const { t } = useTranslation('settings');
  const setScreen = useShellStore((state) => state.setScreen);

  const navigate = (view: HomeView): void => {
    if (view !== 'settings') {
      setScreen('home');
    }
  };

  return (
    <div className="relative flex h-full w-full bg-surface-canvas text-fg-primary overflow-hidden">
      <HomeSidebar active="settings" onNavigate={navigate} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface-canvas">
        <div
          data-tauri-drag-region
          className="mx-4 mt-4 flex shrink-0 items-center justify-between pb-3 border-b border-line-subtle"
        >
          <h1 data-tauri-drag-region className="text-base font-semibold text-fg-primary">
            {t('title')}
          </h1>
          <WindowControls />
        </div>

        {/* Only the sections scroll; the title row with the window controls
            stays put. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {/* Two columns from a laptop width up: the short groups stacked on
              the left, the agent connection, which is the tall one, on the
              right. One narrow column left half the window empty. */}
          <div className="grid grid-cols-1 gap-4 pt-4 lg:grid-cols-2 lg:items-start">
            <div className="flex flex-col gap-4">
              <StorageCard />
              <GeneralSection />
              <AboutSection />
            </div>
            <McpCard />
          </div>
        </div>
      </main>
    </div>
  );
}

/** The theme and the language, and whether the window's background effect applied. */
function GeneralSection(): ReactElement {
  const { t, i18n } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const theme = useShellStore((state) => state.theme);
  const setTheme = useShellStore((state) => state.setTheme);
  const vibrancy = useShellStore((state) => state.vibrancy);
  const vibrancyReason = translateError(vibrancy.reason);

  return (
    <Card title={t('appearance.title')} description={t('appearance.description')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          size="sm"
          label={tCommon('theme.label')}
          value={theme}
          options={THEMES.map((option) => ({ value: option, label: tCommon(`theme.${option}`) }))}
          onValueChange={(value) => {
            const next = THEMES.find((option) => option === value);
            if (next !== undefined) {
              setTheme(next);
            }
          }}
        />
        <Select
          size="sm"
          label={tCommon('language.label')}
          value={i18n.language}
          options={LANGUAGES.map((language) => ({
            value: language,
            label: tCommon(`language.${language}`),
            tag: language.toUpperCase(),
          }))}
          onValueChange={(value) => {
            const next = LANGUAGES.find((language) => language === value);
            if (next !== undefined) {
              void setLanguage(next);
            }
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
  );
}

/** What this build is: the facts to quote in a bug report. */
function AboutSection(): ReactElement {
  const { t } = useTranslation('settings');
  const sidecar = useShellStore((state) => state.sidecar);
  const appVersion = useShellStore((state) => state.appVersion);

  return (
    <Card title={t('about.title')}>
      {/* A two column grid, so the values line up with each other. Laying
          each row out as its own flex line puts the value wherever that row's
          label happens to end, and three labels of different lengths then
          read as three ragged gaps. */}
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
  );
}
