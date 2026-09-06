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

import { useCallback, useEffect, useState } from 'react';

import {
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowToggleMaximize,
  type ShellResult,
} from '@/lib/tauri';
import { useToastStore } from '@/stores/useToastStore';

/**
 * Reports a window command that did not go through.
 *
 * A failed press used to be dropped on the floor, so a window that refused to
 * minimise looked like a button that did nothing.
 *
 * `shell.unavailable` is the one failure that is not reported. It means the
 * page is not inside a Tauri window at all, which is the documented no-op
 * below rather than a command the user asked for and did not get; raising it
 * would put a warning on screen for every press in a plain browser and in
 * every test that renders the title bar.
 *
 * @param result - What the command returned.
 */
function report(result: ShellResult<unknown>): void {
  if (result.ok || result.error.code === 'shell.unavailable') {
    return;
  }
  useToastStore.getState().notify({
    severity: 'warning',
    messageKey: 'errors:window.command_failed',
  });
}

/** Window actions, and whether the window is currently maximized. */
export interface WindowControls {
  maximized: boolean;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Drives the buttons in the custom title bar.
 *
 * Outside a Tauri window every call is a no-op, so the title bar still renders
 * in tests and in a plain browser.
 *
 * @returns The window actions and the maximized state.
 */
export function useWindowControls(): WindowControls {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled: boolean = false;
    void windowIsMaximized().then((result) => {
      if (!cancelled && result.ok) {
        setMaximized(result.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const minimize = useCallback(async () => {
    report(await windowMinimize());
  }, []);

  const toggleMaximize = useCallback(async () => {
    const result = await windowToggleMaximize();
    if (result.ok) {
      setMaximized(result.value);
      return;
    }
    report(result);
  }, []);

  const close = useCallback(async () => {
    report(await windowClose());
  }, []);

  return { maximized, minimize, toggleMaximize, close };
}
