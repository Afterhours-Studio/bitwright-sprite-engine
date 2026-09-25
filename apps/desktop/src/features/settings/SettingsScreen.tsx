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

import { useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WindowControls } from '@/components/layout/WindowControls';
import { HomeSidebar, type HomeView } from '@/features/home/HomeSidebar';
import { StorageCard } from '@/features/settings/StorageCard';
import McpCard from '@/features/settings/mcp/McpCard';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { THEMES, useShellStore } from '@/stores/useShellStore';

const REPOSITORY = 'https://github.com/Afterhours-Studio/bitwright-sprite-engine';

/** The section surface every settings group sits on. */
const SECTION = 'rounded-md border border-line-subtle bg-surface-content p-4';

/**
 * The settings screen, in home's frame: the same sidebar with Settings
 * active, and a content area styled like home's.
 *
 * The sections run in the order a person reaches for them: where data is
 * kept, which is the one decision that costs something to get wrong; the
 * agent connection, which half of the drawing depends on; the two choices
 * that apply the moment they are made; and then the facts to quote in a bug
 * report.
 *
 * Home keeps which of its views is showing in its own state, so choosing
 * Recent or Projects here opens home on the view it starts on rather than on
 * the one chosen; the sidebar's Settings entry is already where this is.
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

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-surface-canvas p-6 lg:p-8">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between pb-3 border-b border-line-subtle"
        >
          <h1 data-tauri-drag-region className="text-base font-semibold text-fg-primary">
            {t('title')}
          </h1>
          <WindowControls />
        </div>

        <div className="flex max-w-3xl flex-col gap-4 pt-4">
          <StorageCard />
          <McpCard />
          <AppearanceSection />
          <LanguageSection />
          <AboutSection />
        </div>
      </main>
    </div>
  );
}

/**
 * One settings group: a heading, an optional line under it, and its controls.
 *
 * @param props - The heading, the description and the body.
 * @returns The section.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className={SECTION}>
      <h2 id={id} className="text-sm font-semibold text-fg-primary">
        {title}
      </h2>
      {description !== undefined && <p className="mt-1 text-xs text-fg-secondary">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A row of small toggles, one of which is on: the same control the new sprite
 * dialog uses for a kind. With two or three choices a row shows them all at
 * once, where a select would hide all but one behind a press.
 *
 * @param props - The group's name, the choices and the one that is on.
 * @returns The row.
 */
function Choices<T extends string>({
  label,
  value,
  options,
  onChoose,
}: {
  label: string;
  value: string;
  options: readonly { value: T; label: string }[];
  onChoose: (value: T) => void;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChoose(option.value);
            }}
            className={cn(
              'rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
              on
                ? 'border-accent bg-accent text-accent-fg hover:bg-accent-hover'
                : 'border-line-subtle bg-surface-content-alt text-fg-secondary hover:border-line hover:text-fg-primary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The theme, and whether the window's background effect applied. */
function AppearanceSection(): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const theme = useShellStore((state) => state.theme);
  const setTheme = useShellStore((state) => state.setTheme);
  const vibrancy = useShellStore((state) => state.vibrancy);
  const vibrancyReason = translateError(vibrancy.reason);

  return (
    <Section title={t('appearance.title')} description={t('appearance.description')}>
      <Choices
        label={tCommon('theme.label')}
        value={theme}
        options={THEMES.map((option) => ({ value: option, label: tCommon(`theme.${option}`) }))}
        onChoose={setTheme}
      />
      <p className="mt-3 text-xs text-fg-secondary">
        {t('appearance.vibrancy')}
        {': '}
        {vibrancy.applied
          ? t('appearance.vibrancyOn')
          : (vibrancyReason ?? t('appearance.vibrancyOff'))}
      </p>
    </Section>
  );
}

/** The interface language. */
function LanguageSection(): ReactElement {
  const { t, i18n } = useTranslation('settings');
  const { t: tCommon } = useTranslation();

  return (
    <Section title={tCommon('language.label')} description={t('language.description')}>
      <Choices
        label={tCommon('language.label')}
        value={i18n.language}
        options={LANGUAGES.map((language) => ({
          value: language,
          label: tCommon(`language.${language}`),
        }))}
        onChoose={(language) => {
          void setLanguage(language);
        }}
      />
    </Section>
  );
}

/** What this build is: the facts to quote in a bug report. */
function AboutSection(): ReactElement {
  const { t } = useTranslation('settings');
  const sidecar = useShellStore((state) => state.sidecar);
  const appVersion = useShellStore((state) => state.appVersion);

  return (
    <Section title={t('about.title')}>
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
    </Section>
  );
}
