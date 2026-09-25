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
 * The editor screen's hold on the animation store and its bottom panel.
 *
 * The bridge is mocked so nothing reaches a shell, and the animation store's
 * subscription is replaced with spies, so what is pinned down is that the
 * editor follows the animation exactly while it is mounted.
 */

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Tauri from '@/lib/tauri';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof Tauri>()),
  invoke: vi.fn(() => new Promise(() => undefined)),
}));

import { EditorScreen } from '@/features/editor/EditorScreen';
import { resources } from '@/lib/i18n';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';

const subscribe = vi.fn(() => Promise.resolve());
const dispose = vi.fn();

beforeEach(() => {
  subscribe.mockClear();
  dispose.mockClear();
  useAnimationStore.setState({ subscribe, dispose });
  useDocumentStore.getState().close();
  useEditorStore.setState({ bottomPanel: 'steps' });
});

describe('EditorScreen', () => {
  it('follows the animation while mounted and lets it go on unmount', () => {
    const { unmount } = render(<EditorScreen />);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('shows the steps strip only when it is the bottom panel', () => {
    const noDocument = resources.en.editor.step.noDocument;
    render(<EditorScreen />);
    expect(screen.getByText(noDocument)).toBeInTheDocument();

    act(() => {
      useEditorStore.getState().setBottomPanel('timeline');
    });
    expect(screen.queryByText(noDocument)).not.toBeInTheDocument();

    act(() => {
      useEditorStore.getState().setBottomPanel(null);
    });
    expect(screen.queryByText(noDocument)).not.toBeInTheDocument();
  });
});
