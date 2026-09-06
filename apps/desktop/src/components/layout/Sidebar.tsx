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

import { Pill } from '@/components/ui/Pill';
import { useShellStore, type Screen } from '@/stores/useShellStore';

const SCREENS: readonly Screen[] = ['generate', 'gallery', 'settings'];

/**
 * Vertical navigation, one pill per screen.
 *
 * Sits on surface-1, one step above the canvas, so the boundary with the main
 * area is visible without a divider.
 */
export function Sidebar(): ReactElement {
  const { t } = useTranslation();
  const screen = useShellStore((state) => state.screen);
  const setScreen = useShellStore((state) => state.setScreen);
  const theme = useShellStore((state) => state.theme);
  const toggleTheme = useShellStore((state) => state.toggleTheme);

  return (
    <nav
      aria-label={t('app.name')}
      className="flex w-52 shrink-0 flex-col justify-between border-e border-line-subtle bg-surface-1 p-3"
    >
      <ul className="flex flex-col gap-1">
        {SCREENS.map((item) => (
          <li key={item}>
            <Pill
              className="w-full"
              active={screen === item}
              onClick={() => {
                setScreen(item);
              }}
            >
              {t(`nav.${item}`)}
            </Pill>
          </li>
        ))}
      </ul>

      <Pill
        className="w-full"
        onClick={() => {
          toggleTheme();
        }}
        aria-label={t('theme.toggle')}
      >
        {theme === 'dark' ? t('theme.light') : t('theme.dark')}
      </Pill>
    </nav>
  );
}
