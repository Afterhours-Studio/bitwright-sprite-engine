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

import { cn } from '@/lib/cn';
import { useWindowControls } from '@/hooks/useWindowControls';
import { useShellStore } from '@/stores/useShellStore';

/**
 * The window's own title bar, drawn because the system decorations are off.
 *
 * Platforms differ in ways that cannot be papered over:
 *
 *   macOS   The system draws the traffic lights over the top left of the
 *           client area. We draw no buttons, and leave room for its through
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
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();

  const systemControls = platform?.systemWindowControls ?? false;

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => {
        void toggleMaximize();
      }}
      className={cn(
        'flex h-titlebar shrink-0 select-none items-center justify-between',
        'border-b border-line-subtle bg-surface-1 pe-2',
      )}
      style={{ paddingInlineStart: 'var(--titlebar-inset-start)' }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2 ps-3">
        <span data-tauri-drag-region className="text-xs font-semibold text-fg-primary">
          {t('app.name')}
        </span>
        <span data-tauri-drag-region className="text-xs text-fg-secondary">
          {t('app.tagline')}
        </span>
      </div>

      {!systemControls && (
        <div className="no-drag flex items-center">
          <WindowButton label={t('window.minimize')} onClick={minimize}>
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </WindowButton>

          <WindowButton
            label={maximized ? t('window.restore') : t('window.maximize')}
            onClick={toggleMaximize}
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
          </WindowButton>

          <WindowButton label={t('window.close')} onClick={close} danger>
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </WindowButton>
        </div>
      )}
    </header>
  );
}

interface WindowButtonProps {
  /** Accessible name. Always a translated string. */
  label: string;
  /** Whether this is the close button, which hovers red. */
  danger?: boolean;
  /** The icon. */
  children: ReactElement;
  /** Called on click. */
  onClick: () => Promise<void> | void;
}

/** One of the window buttons drawn on Windows and Linux. */
function WindowButton({
  label,
  danger = false,
  children,
  onClick,
}: WindowButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void onClick();
      }}
      className={cn(
        'flex h-titlebar w-11 items-center justify-center text-fg-secondary transition-colors',
        danger
          ? 'hover:bg-danger hover:text-danger-fg'
          : 'hover:bg-surface-2 hover:text-fg-primary',
      )}
    >
      {children}
    </button>
  );
}
