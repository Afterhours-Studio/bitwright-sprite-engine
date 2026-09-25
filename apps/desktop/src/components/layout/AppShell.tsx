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

import { CommandPalette } from '@/components/ui/CommandPalette';
import { ToastViewport } from '@/components/ui/ToastViewport';
import { NewSpriteDialog } from '@/features/home/NewSpriteDialog';

export interface AppShellProps {
  /** The current screen. */
  children: ReactNode;
}

/**
 * The window frame: a bezel, and the current screen filling the container
 * inside it.
 *
 * The bezel is the ring of window around the interface. With a background
 * effect active it is transparent, so the platform draws Mica or vibrancy
 * there; without one it is the anchor colour, a deliberate dark frame. It
 * carries no text, which is what makes that safe in both modes. Everything
 * readable sits on the opaque container inside it, rounded to the window's
 * inner radius.
 *
 * NO TITLE BAR. Each screen's own top row is the window's drag region and
 * carries the window controls, so the frame adds nothing above it.
 *
 * THE LAYERS EVERY SCREEN SHARES ARE MOUNTED HERE, ONCE. The new sprite dialog
 * is opened from home, the editor header and the command palette; the palette
 * from a shortcut that works anywhere; a toast can be raised by any screen or
 * store before a screen has settled. None of them belongs to whichever screen
 * is in front. The container is `relative` so the palette, which positions
 * itself with `absolute inset-0`, covers the content and never the bezel, so
 * an open palette does not paint over the window's own rounded corner.
 */
export function AppShell({ children }: AppShellProps): ReactElement {
  return (
    <div className="app-bezel h-full">
      <div className="relative flex h-full flex-col overflow-hidden rounded-window-inner bg-surface-canvas text-fg-primary">
        {/* A plain container rather than `main`: each screen names its own
            main region, and a landmark inside a landmark of the same kind is
            two answers to "where is the content". */}
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
        <NewSpriteDialog />
        <CommandPalette />
        <ToastViewport />
      </div>
    </div>
  );
}
