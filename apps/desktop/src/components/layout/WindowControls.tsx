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

import { Copy, Minus, Square, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useWindowControls } from '@/hooks/useWindowControls';
import { cn } from '@/lib/cn';
import { useShellStore } from '@/stores/useShellStore';

/** The shared shape of the three buttons, on the dark studio header. */
const BASE = 'no-drag p-1.5 rounded text-neutral-400';

/**
 * Minimise and maximise. Close has its own hover, written in place of this one
 * rather than on top of it: two hover backgrounds on one element are decided
 * by stylesheet order, not by which was meant.
 */
const BUTTON = cn(BASE, 'hover:text-neutral-100 hover:bg-neutral-800');

/**
 * Minimise, maximise or restore, and close, for a window with no system
 * decorations.
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
 * gaps between them still drag the window like the rest of the header.
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
    <div className="flex items-center space-x-0.5">
      <button
        type="button"
        aria-label={t('window.minimize')}
        title={t('window.minimize')}
        className={BUTTON}
        onClick={() => void minimize()}
      >
        <Minus aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        className={BUTTON}
        onClick={() => void toggleMaximize()}
      >
        {maximized ? (
          <Copy aria-hidden="true" className="w-3.5 h-3.5" />
        ) : (
          <Square aria-hidden="true" className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        type="button"
        aria-label={t('window.close')}
        title={t('window.close')}
        className={cn(BASE, 'hover:bg-danger hover:text-danger-fg')}
        onClick={() => void close()}
      >
        <X aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
