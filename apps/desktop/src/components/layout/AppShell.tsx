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
 * The window frame: one opaque dark surface the size of the window, with the
 * current screen filling it.
 *
 * NO BEZEL AND NO TITLE BAR. Each screen's own top row is the window's drag
 * region and carries the window controls, so the frame adds nothing above it.
 *
 * OPAQUE, ON PURPOSE. The window is created transparent so the platform can
 * put Mica or vibrancy behind it, and `data-vibrancy="on"` clears the page
 * background for that. The studio look has no translucent surface left to
 * show the effect through, so this frame paints `bg-neutral-950` over all of
 * it whatever the shell reports: text never ends up on the wallpaper. It is
 * rounded to the window's own radius, which is what the system clips an
 * undecorated window to on Windows 11 and macOS, so the corner outside it is
 * the one the platform would have cut away anyway.
 *
 * THE LAYERS EVERY SCREEN SHARES ARE MOUNTED HERE, ONCE. The new sprite dialog
 * is opened from home, the editor header and the command palette; the palette
 * from a shortcut that works anywhere; a toast can be raised by any screen or
 * store before a screen has settled. None of them belongs to whichever screen
 * is in front. The frame is `relative` so the palette, which positions itself
 * with `absolute inset-0`, covers the window and nothing outside it.
 */
export function AppShell({ children }: AppShellProps): ReactElement {
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-window bg-neutral-950 text-neutral-100">
      {/* A plain container rather than `main`: each screen names its own main
          region, and a landmark inside a landmark of the same kind is two
          answers to "where is the content". */}
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      <NewSpriteDialog />
      <CommandPalette />
      <ToastViewport />
    </div>
  );
}
