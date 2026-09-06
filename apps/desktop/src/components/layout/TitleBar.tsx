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

import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { useWindowControls } from '@/hooks/useWindowControls';
import { cn } from '@/lib/cn';
import { useShellStore, type Screen } from '@/stores/useShellStore';

const SCREENS: readonly Screen[] = ['generate', 'gallery', 'settings'];

/**
 * The window's own title bar, drawn because the system decorations are off, and
 * carrying the primary navigation.
 *
 * The navigation is a horizontal row of pills here rather than a vertical rail
 * down the side. Three screens do not justify a permanent column, and putting
 * them in the title bar gives the whole width back to the content.
 *
 * Platforms differ in ways that cannot be papered over:
 *
 *   macOS   The system draws the traffic lights over the top left of the
 *           client area. We draw no buttons, and leave room for them through
 *           the `--titlebar-inset-start` token, set by `[data-platform]`.
 *   Windows Nothing is drawn for us. We draw minimize, maximize, and close on
 *           the right, in that order, and the close button takes the system
 *           red on hover.
 *   Linux   Nothing is drawn for us either, and button placement varies by
 *           desktop environment. The right is the common default.
 *
 * The drag region is marked with `data-tauri-drag-region`. Double clicking it
 * maximizes, which is what every platform's own title bar does.
 */
export function TitleBar(): ReactElement {
  const { t } = useTranslation();
  const platform = useShellStore((state) => state.platform);
  const screen = useShellStore((state) => state.screen);
  const setScreen = useShellStore((state) => state.setScreen);
  const theme = useShellStore((state) => state.theme);
  const toggleTheme = useShellStore((state) => state.toggleTheme);
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();

  const systemControls = platform?.systemWindowControls ?? false;

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => {
        void toggleMaximize();
      }}
      className="flex h-titlebar shrink-0 select-none items-center gap-4 px-3"
      style={{ paddingInlineStart: 'var(--titlebar-inset-start)' }}
    >
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-2 ps-1">
        <span data-tauri-drag-region className="text-sm font-semibold text-fg-primary">
          {t('app.name')}
        </span>
        <span data-tauri-drag-region className="hidden text-xs text-fg-secondary sm:inline">
          {t('app.tagline')}
        </span>
      </div>

      <nav aria-label={t('app.name')} className="no-drag flex flex-1 justify-center gap-2">
        {SCREENS.map((item) => (
          <Pill
            key={item}
            active={screen === item}
            onClick={() => {
              setScreen(item);
            }}
          >
            {t(`nav.${item}`)}
          </Pill>
        ))}
      </nav>

      <div className="no-drag flex shrink-0 items-center gap-2">
        <IconButton
          label={t('theme.toggle')}
          onClick={() => {
            toggleTheme();
          }}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </IconButton>

        {!systemControls && (
          <>
            <IconButton label={t('window.minimize')} onClick={() => void minimize()}>
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
              </svg>
            </IconButton>

            <IconButton
              label={maximized ? t('window.restore') : t('window.maximize')}
              onClick={() => void toggleMaximize()}
            >
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            </IconButton>

            <IconButton label={t('window.close')} danger onClick={() => void close()}>
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
              </svg>
            </IconButton>
          </>
        )}
      </div>
    </header>
  );
}

/** Shown while the dark theme is active, because it switches to light. */
function SunIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={cn('h-4 w-4')} aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Shown while the light theme is active, because it switches to dark. */
function MoonIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={cn('h-4 w-4')} aria-hidden="true" fill="none">
      <path
        d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5a5.8 5.8 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
