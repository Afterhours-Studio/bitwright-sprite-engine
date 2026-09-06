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

import type { ReactNode, ReactElement } from 'react';

import { Sidebar } from '@/components/layout/Sidebar';
import { StatusBar } from '@/components/layout/StatusBar';
import { TitleBar } from '@/components/layout/TitleBar';

export interface AppShellProps {
  /** The current screen. */
  children: ReactNode;
}

/**
 * The window frame: title bar, sidebar, content, status bar.
 *
 * The elevation runs canvas at the back, surface-1 for the chrome, and
 * surface-2 for cards inside a screen.
 *
 * The content area is painted with `bg-surface-content`, which is opaque in
 * every mode. The canvas token goes fully transparent when a background effect
 * is active, so a screen drawn straight onto it would put its text over the
 * user's wallpaper. Chrome is the only part that may be translucent.
 */
export function AppShell({ children }: AppShellProps): ReactElement {
  return (
    <div className="flex h-full flex-col bg-surface-canvas text-fg-primary">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-auto bg-surface-content">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
