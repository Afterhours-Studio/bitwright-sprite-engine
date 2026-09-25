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

import { TOOLS, TOOL_KEYS, useEditorStore, type Tool } from '@/stores/useEditorStore';

/** Each tool's key, lower-cased, so a press matches with or without Shift or Caps Lock. */
const TOOL_BY_KEY: ReadonlyMap<string, Tool> = new Map(
  TOOLS.map((tool) => [TOOL_KEYS[tool].toLowerCase(), tool]),
);

/**
 * Whether the press was made while typing.
 *
 * A single-letter shortcut fired from a name field would switch tools on
 * every word the user types, so anything that takes text keeps its keys.
 *
 * @param target - Where the event came from.
 * @returns True for inputs, text areas, selects and editable content.
 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target.isContentEditable ||
    target.closest('[contenteditable="true"], [contenteditable=""]')
  ) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The editor's single-key shortcuts: a tool's letter chooses it, X swaps the
 * primary and secondary colours, Escape drops the selection.
 *
 * Mounted once by the editor screen. Only the keys that belong to the tool
 * state live here: Space-pan, zoom and Delete belong to the stage, which knows
 * where the cursor is, and undo and redo to the header, which owns history.
 * Presses with Ctrl, Meta or Alt are left alone so this never shadows an
 * application or system chord.
 */
export function useToolShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (typing(event.target)) {
        return;
      }
      const store = useEditorStore.getState();
      if (event.key === 'Escape') {
        store.clearSelection();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'x') {
        event.preventDefault();
        store.swapSlots();
        return;
      }
      const tool = TOOL_BY_KEY.get(key);
      if (tool !== undefined) {
        event.preventDefault();
        store.setTool(tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
