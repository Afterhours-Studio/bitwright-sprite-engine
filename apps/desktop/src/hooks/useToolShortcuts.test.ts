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

/**
 * The single-key shortcuts must reach the store, and must stay out of the way
 * of typing and of modifier chords that belong to someone else.
 */

import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useToolShortcuts } from '@/hooks/useToolShortcuts';
import { TOOLS, TOOL_KEYS, useEditorStore } from '@/stores/useEditorStore';

beforeEach(() => {
  useEditorStore.setState({
    tool: 'pencil',
    slot: 1,
    secondarySlot: 2,
    selection: { width: 1, height: 1, mask: new Uint8Array([1]) },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useToolShortcuts', () => {
  it('chooses every tool by its key, in either case', () => {
    renderHook(() => {
      useToolShortcuts();
    });
    for (const tool of TOOLS) {
      useEditorStore.setState({ tool: tool === 'pencil' ? 'eraser' : 'pencil' });
      fireEvent.keyDown(window, { key: TOOL_KEYS[tool].toLowerCase() });
      expect(useEditorStore.getState().tool).toBe(tool);
    }
    fireEvent.keyDown(window, { key: 'E' });
    expect(useEditorStore.getState().tool).toBe('eraser');
  });

  it('swaps colours on X and drops the selection on Escape', () => {
    renderHook(() => {
      useToolShortcuts();
    });
    fireEvent.keyDown(window, { key: 'x' });
    expect(useEditorStore.getState().slot).toBe(2);
    expect(useEditorStore.getState().secondarySlot).toBe(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('ignores presses with Ctrl, Meta or Alt held', () => {
    renderHook(() => {
      useToolShortcuts();
    });
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'e', metaKey: true });
    fireEvent.keyDown(window, { key: 'e', altKey: true });
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
    expect(useEditorStore.getState().tool).toBe('pencil');
    expect(useEditorStore.getState().slot).toBe(1);
  });

  it('ignores presses made while typing', () => {
    renderHook(() => {
      useToolShortcuts();
    });
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.append(input, area, select, editable);

    for (const target of [input, area, select, editable, inner]) {
      fireEvent.keyDown(target, { key: 'e' });
      fireEvent.keyDown(target, { key: 'x' });
      fireEvent.keyDown(target, { key: 'Escape' });
    }
    expect(useEditorStore.getState().tool).toBe('pencil');
    expect(useEditorStore.getState().slot).toBe(1);
    expect(useEditorStore.getState().selection).not.toBeNull();
  });

  it('stops listening when unmounted', () => {
    const { unmount } = renderHook(() => {
      useToolShortcuts();
    });
    unmount();
    fireEvent.keyDown(window, { key: 'e' });
    expect(useEditorStore.getState().tool).toBe('pencil');
  });
});
