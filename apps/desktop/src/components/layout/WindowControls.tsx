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

import { Tooltip } from '@/components/ui/Tooltip';
import { useWindowControls } from '@/hooks/useWindowControls';
import { cn } from '@/lib/cn';
import { useShellStore } from '@/stores/useShellStore';

/**
 * The shared shape of the three buttons: 1.0's icon button, the raised chip on
 * the content surface, drawn a size down so the editor's header still fits a
 * 1280px window with all three beside it.
 */
const BASE =
  'no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-content text-fg-secondary shadow-sm transition-colors';

/**
 * Minimise and maximise. Close has its own hover, written in place of this one
 * rather than on top of it: two hover colours on one element are decided by
 * stylesheet order, not by which was meant.
 */
const BUTTON = cn(BASE, 'hover:bg-surface-content-alt hover:text-fg-primary');

/** Close, in the system red under the pointer. */
const CLOSE = cn(BASE, 'hover:bg-danger hover:text-danger-fg');

/**
 * Minimise, maximise or restore, and close, for a window with no system
 * decorations, drawn as 1.0's title bar drew them: a raised chip with a thin
 * ten-pixel glyph, and the platform's red on close hover.
 *
 * DRAWN ONLY WHERE NOTHING ELSE DRAWS THEM. macOS paints its traffic lights
 * over the client area, and the shell reports that as
 * `platform.systemWindowControls`; a second set beside them would be two
 * close buttons. The macOS check is kept as well, so the window never shows
 * both even before the flag has been read correctly for a new platform. While
 * the platform is still unknown the buttons are drawn, because a window with
 * no way to close it is worse than one that briefly shows a button too many.
 *
 * Each button carries `no-drag` itself rather than the row doing so, so the
 * gaps between them still drag the window like the rest of the header. The
 * labels are drawn by `Tooltip` rather than `title`, which the system would
 * draw outside the theme.
 *
 * @returns The three buttons, or nothing where the system draws its own.
 */
export function WindowControls(): ReactElement | null {
  const { t } = useTranslation('studio');
  const platform = useShellStore((state) => state.platform);
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();

  if (platform !== null && (platform.systemWindowControls || platform.os === 'macos')) {
    return null;
  }

  const maximizeLabel = maximized ? t('window.restore') : t('window.maximize');

  return (
    <div className="flex items-center gap-1">
      <Tooltip label={t('window.minimize')}>
        <button
          type="button"
          aria-label={t('window.minimize')}
          className={BUTTON}
          onClick={() => void minimize()}
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </Tooltip>

      <Tooltip label={maximizeLabel}>
        <button
          type="button"
          aria-label={maximizeLabel}
          className={BUTTON}
          onClick={() => void toggleMaximize()}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="none">
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
              <path d="M2.5 2.5V0.5h7v7h-2" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
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
          )}
        </button>
      </Tooltip>

      <Tooltip label={t('window.close')}>
        <button
          type="button"
          aria-label={t('window.close')}
          className={CLOSE}
          onClick={() => void close()}
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}
