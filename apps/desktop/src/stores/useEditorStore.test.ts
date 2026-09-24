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
 * What the pixel editor is set to draw with: the clamped ranges, the coupling
 * between the shape flyout and the shape tool, and the view overlays that
 * outlive the window.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveValue } from '@/lib/persist';
import {
  DEFAULT_BRUSH_SHAPE,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_SHAPE,
  DEFAULT_TOOL,
  FIRST_SLOT,
  MAX_BRUSH_SIZE,
  MAX_SLOT,
  MIN_BRUSH_SIZE,
  useEditorStore,
} from '@/stores/useEditorStore';

vi.mock('@/lib/persist', () => ({
  loadValue: vi.fn(() => null),
  saveValue: vi.fn(),
  STORAGE_KEYS: { notifications: 'bitwright.notifications', view: 'bitwright.view' },
}));

beforeEach(() => {
  vi.mocked(saveValue).mockClear();
  useEditorStore.setState({
    tool: DEFAULT_TOOL,
    shape: DEFAULT_SHAPE,
    brushSize: DEFAULT_BRUSH_SIZE,
    brushShape: DEFAULT_BRUSH_SHAPE,
    slot: FIRST_SLOT,
    targetRole: null,
    showPixelGrid: true,
    showCheckerboard: true,
  });
});

describe('setTool', () => {
  it('sets the tool', () => {
    useEditorStore.getState().setTool('eraser');
    expect(useEditorStore.getState().tool).toBe('eraser');
  });
});

describe('setShape', () => {
  it('sets the shape and forces the tool to shape', () => {
    useEditorStore.getState().setTool('pencil');
    useEditorStore.getState().setShape('ellipse');

    const state = useEditorStore.getState();
    expect(state.shape).toBe('ellipse');
    expect(state.tool).toBe('shape');
  });
});

describe('setBrushSize', () => {
  it('clamps to the maximum', () => {
    useEditorStore.getState().setBrushSize(999);
    expect(useEditorStore.getState().brushSize).toBe(MAX_BRUSH_SIZE);
  });

  it('clamps to the minimum', () => {
    useEditorStore.getState().setBrushSize(-5);
    expect(useEditorStore.getState().brushSize).toBe(MIN_BRUSH_SIZE);
  });

  it('rounds a fractional size', () => {
    useEditorStore.getState().setBrushSize(3.6);
    expect(useEditorStore.getState().brushSize).toBe(4);
  });

  it('falls back to the default on NaN', () => {
    useEditorStore.getState().setBrushSize(Number.NaN);
    expect(useEditorStore.getState().brushSize).toBe(DEFAULT_BRUSH_SIZE);
  });
});

describe('setBrushShape', () => {
  it('sets the brush footprint', () => {
    useEditorStore.getState().setBrushShape('square');
    expect(useEditorStore.getState().brushShape).toBe('square');
  });
});

describe('setSlot', () => {
  it('clamps to the highest slot', () => {
    useEditorStore.getState().setSlot(999);
    expect(useEditorStore.getState().slot).toBe(MAX_SLOT);
  });

  it('clamps to the lowest slot', () => {
    useEditorStore.getState().setSlot(-5);
    expect(useEditorStore.getState().slot).toBe(FIRST_SLOT);
  });

  it('falls back to the first slot on NaN', () => {
    useEditorStore.getState().setSlot(Number.NaN);
    expect(useEditorStore.getState().slot).toBe(FIRST_SLOT);
  });
});

describe('setTargetRole', () => {
  it('sets an override role', () => {
    useEditorStore.getState().setTargetRole('outline');
    expect(useEditorStore.getState().targetRole).toBe('outline');
  });

  it('clears the override back to null', () => {
    useEditorStore.getState().setTargetRole('outline');
    useEditorStore.getState().setTargetRole(null);
    expect(useEditorStore.getState().targetRole).toBeNull();
  });
});

describe('setShowPixelGrid', () => {
  it('updates the state and persists the view preferences', () => {
    useEditorStore.getState().setShowPixelGrid(false);

    expect(useEditorStore.getState().showPixelGrid).toBe(false);
    expect(saveValue).toHaveBeenCalledWith('bitwright.view', {
      showPixelGrid: false,
      showCheckerboard: true,
    });
  });
});

describe('setShowCheckerboard', () => {
  it('updates the state and persists the view preferences', () => {
    useEditorStore.getState().setShowCheckerboard(false);

    expect(useEditorStore.getState().showCheckerboard).toBe(false);
    expect(saveValue).toHaveBeenCalledWith('bitwright.view', {
      showPixelGrid: true,
      showCheckerboard: false,
    });
  });
});
