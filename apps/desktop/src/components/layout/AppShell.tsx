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

import { StatusBar } from '@/components/layout/StatusBar';
import { TitleBar } from '@/components/layout/TitleBar';

export interface AppShellProps {
  /** The current screen. */
  children: ReactNode;
}

/**
 * The window frame: a dark bezel, a title bar carrying the navigation, the
 * content area, and a floating status pill.
 *
 * The bezel is what makes the window read as one object rather than as a
 * browser pane, and it is where the rounded corners are drawn. Inside it the
 * canvas is grey, and every text-bearing surface on that canvas is a card.
 *
 * The status pill floats over the content rather than sitting in the layout,
 * so the content area is given bottom padding to keep anything from ending up
 * underneath it.
 */
export function AppShell({ children }: AppShellProps): ReactElement {
  return (
    <div className="app-bezel h-full">
      <div className="relative flex h-full flex-col overflow-hidden rounded-md bg-surface-canvas text-fg-primary">
        <TitleBar />
        <main className="min-h-0 flex-1 overflow-auto pb-12">{children}</main>
        <StatusBar />
      </div>
    </div>
  );
}
