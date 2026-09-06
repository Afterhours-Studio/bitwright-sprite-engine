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
import type { ReactElement, ReactNode } from 'react';

import { TitleBar } from '@/components/layout/TitleBar';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { ToastViewport } from '@/components/ui/ToastViewport';

export interface AppShellProps {
  /** The current screen. */
  children: ReactNode;
}

/**
 * The window frame: a bezel, a title bar carrying the navigation, and the
 * content area.
 *
 * The bezel is the ring of window around the interface. With a background
 * effect active it is transparent, so the platform draws Mica or vibrancy
 * there; it carries no text, which is what makes that safe in both modes.
 *
 * The command palette is mounted here, once, beside the content area rather
 * than inside a screen. It is reached from the title bar and from a shortcut
 * that works anywhere, so it cannot belong to whichever screen happens to be
 * open. It covers this container and not the bezel, so an open palette never
 * paints over the window's own rounded corner.
 *
 * The toast layer is mounted here for the same two reasons, and in the same
 * place. A notification can be raised by any screen, by a store, or by the
 * shell before a screen has even settled, so it belongs to none of them; and it
 * is clipped to this container rather than the window, so a toast never paints
 * over the bezel either.
 *
 * There is no status bar. Each screen supplies its own dock if it has tools
 * worth docking, which is why the content area is the positioning context.
 */
export function AppShell({ children }: AppShellProps): ReactElement {
  return (
    <div className="app-bezel h-full">
      <div className="relative flex h-full flex-col overflow-hidden rounded-window-inner bg-surface-canvas text-fg-primary">
        <TitleBar />
        <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
        <CommandPalette />
        <ToastViewport />
      </div>
    </div>
  );
}
