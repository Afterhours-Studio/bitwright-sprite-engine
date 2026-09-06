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
import { useEffect } from 'react';

import type { PlatformInfo } from '@/lib/tauri';
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';
import { useShellStore } from '@/stores/useShellStore';

/**
 * Whether the palette's modifier is held for this platform.
 *
 * The two platforms disagree about which key means "application command", and
 * using the wrong one is worse than useless: Ctrl+K on macOS is the system's
 * own "kill to end of line" in every text field, so binding it there would
 * steal a key the user already has a meaning for.
 *
 * Either modifier is accepted while the platform is unknown, which is the
 * window between the first paint and the shell answering. A shortcut that does
 * nothing for the first few hundred milliseconds is a shortcut the user
 * concludes is broken.
 *
 * @param event - The key press being considered.
 * @param os - The host platform, or null before the shell has answered.
 * @returns True when the press carries this platform's modifier.
 */
function acceleratorHeld(event: KeyboardEvent, os: PlatformInfo['os'] | null): boolean {
  if (os === 'macos') {
    return event.metaKey;
  }
  if (os === null) {
    return event.ctrlKey || event.metaKey;
  }
  return event.ctrlKey;
}

/**
 * Binds Ctrl+K, or Cmd+K on macOS, to the command palette.
 *
 * Bound on the window rather than on the palette itself, because the shortcut
 * has to work while focus is anywhere in the application, including inside the
 * prompt field. It toggles rather than opens, so the same key closes what it
 * opened without the user having to reach for Escape.
 */
export function useCommandPaletteShortcut(): void {
  const platform = useShellStore((state) => state.platform);
  const toggle = useCommandPaletteStore((state) => state.toggle);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Shift and Alt are excluded rather than ignored: Ctrl+Shift+K is a
      // different shortcut on every platform this ships on, and swallowing it
      // here would be a collision the user cannot see.
      if (event.key.toLowerCase() !== 'k' || event.shiftKey || event.altKey) {
        return;
      }
      if (!acceleratorHeld(event, platform?.os ?? null)) {
        return;
      }
      // The web view binds Ctrl+K itself in some engines. Whatever it would
      // have done, it is not what the user asked for.
      event.preventDefault();
      toggle();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [platform, toggle]);
}
