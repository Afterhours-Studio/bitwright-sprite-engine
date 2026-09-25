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
 * What the pixel editor is set to draw with: the tool set and its keys, the
 * clamped ranges, the two slots, the selection, and the view preferences that
 * outlive the window.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveValue } from '@/lib/persist';
import {
  DEFAULT_BRUSH_SHAPE,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_SECONDARY_SLOT,
  DEFAULT_TOOL,
  FIRST_SLOT,
  MAX_BRUSH_SIZE,
  MAX_SLOT,
  MIN_BRUSH_SIZE,
  SHAPE_TOOLS,
  shapeOf,
  TOOL_KEYS,
  TOOLS,
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
    brushSize: DEFAULT_BRUSH_SIZE,
    brushShape: DEFAULT_BRUSH_SHAPE,
    slot: FIRST_SLOT,
    secondarySlot: DEFAULT_SECONDARY_SLOT,
    shapeFill: false,
    symmetry: 'off',
    selection: null,
    targetRole: null,
    showPixelGrid: true,
    showCheckerboard: true,
    tileGuide: 0,
    showLayersPanel: true,
    bottomPanel: 'steps',
  });
});

describe('setTool', () => {
  it('sets the tool', () => {
    useEditorStore.getState().setTool('eraser');
    expect(useEditorStore.getState().tool).toBe('eraser');
  });
});

describe('the tool set', () => {
  it('lists the rail in order', () => {
    expect(TOOLS).toEqual([
      'pencil',
      'eraser',
      'fill',
      'eyedropper',
      'select',
      'wand',
      'move',
      'pan',
      'zoom',
      'line',
      'curve',
      'rectangle',
      'ellipse',
      'dither',
      'lighten',
      'darken',
    ]);
  });

  it('gives every tool its own key', () => {
    expect(TOOLS.map((tool) => TOOL_KEYS[tool]).join(' ')).toBe('B E G I M W V H Z L Q U C J O K');
  });

  it('reads the figure back from a shape tool, and nothing from the rest', () => {
    for (const shape of SHAPE_TOOLS) {
      expect(shapeOf(shape)).toBe(shape);
    }
    expect(shapeOf('pencil')).toBeNull();
    expect(shapeOf('fill')).toBeNull();
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
      tileGuide: 0,
      showLayersPanel: true,
      bottomPanel: 'steps',
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
      tileGuide: 0,
      showLayersPanel: true,
      bottomPanel: 'steps',
    });
  });
});

describe('setSecondarySlot', () => {
  it('starts on slot 2', () => {
    expect(useEditorStore.getInitialState().secondarySlot).toBe(2);
  });

  it('clamps like the primary slot', () => {
    useEditorStore.getState().setSecondarySlot(999);
    expect(useEditorStore.getState().secondarySlot).toBe(MAX_SLOT);
    useEditorStore.getState().setSecondarySlot(0);
    expect(useEditorStore.getState().secondarySlot).toBe(FIRST_SLOT);
  });

  it('falls back to the default on NaN', () => {
    useEditorStore.getState().setSecondarySlot(Number.NaN);
    expect(useEditorStore.getState().secondarySlot).toBe(DEFAULT_SECONDARY_SLOT);
  });
});

describe('swapSlots', () => {
  it('trades the primary and the secondary slot', () => {
    useEditorStore.getState().setSlot(5);
    useEditorStore.getState().setSecondarySlot(9);
    useEditorStore.getState().swapSlots();

    const state = useEditorStore.getState();
    expect(state.slot).toBe(9);
    expect(state.secondarySlot).toBe(5);
  });
});

describe('setShapeFill and setSymmetry', () => {
  it('sets the fill and the mirror axes, and remembers neither', () => {
    useEditorStore.getState().setShapeFill(true);
    useEditorStore.getState().setSymmetry('both');

    const state = useEditorStore.getState();
    expect(state.shapeFill).toBe(true);
    expect(state.symmetry).toBe('both');
    expect(saveValue).not.toHaveBeenCalled();
  });
});

describe('selection', () => {
  it('holds a mask that matches its size, and drops it', () => {
    const mask = new Uint8Array(6).fill(1);
    useEditorStore.getState().setSelection({ width: 3, height: 2, mask });
    expect(useEditorStore.getState().selection).toEqual({ width: 3, height: 2, mask });

    useEditorStore.getState().clearSelection();
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('refuses a mask that does not match its size', () => {
    expect(() => {
      useEditorStore.getState().setSelection({ width: 3, height: 2, mask: new Uint8Array(5) });
    }).toThrow(RangeError);
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('keeps the asset a selection was made on', () => {
    const mask = new Uint8Array(2).fill(1);
    useEditorStore.getState().setSelection({ width: 2, height: 1, mask, assetId: 'asset-a' });

    expect(useEditorStore.getState().selection?.assetId).toBe('asset-a');
    useEditorStore.getState().clearSelection();
  });
});

describe('view preferences', () => {
  it('persists the tile guide and the two panels with the overlays', () => {
    useEditorStore.getState().setTileGuide(16);
    useEditorStore.getState().setShowLayersPanel(false);
    useEditorStore.getState().setBottomPanel(null);

    const state = useEditorStore.getState();
    expect(state.tileGuide).toBe(16);
    expect(state.showLayersPanel).toBe(false);
    expect(state.bottomPanel).toBeNull();
    expect(saveValue).toHaveBeenLastCalledWith('bitwright.view', {
      showPixelGrid: true,
      showCheckerboard: true,
      tileGuide: 16,
      showLayersPanel: false,
      bottomPanel: null,
    });
  });

  it('starts with no tile guide and both panels shown', () => {
    const initial = useEditorStore.getInitialState();
    expect(initial.tileGuide).toBe(0);
    expect(initial.showLayersPanel).toBe(true);
    expect(initial.bottomPanel).toBe('steps');
  });

  it('switches the bottom panel between the timeline and the steps', () => {
    useEditorStore.getState().setBottomPanel('timeline');
    expect(useEditorStore.getState().bottomPanel).toBe('timeline');
    expect(saveValue).toHaveBeenLastCalledWith(
      'bitwright.view',
      expect.objectContaining({ bottomPanel: 'timeline' }),
    );
  });
});

describe('stored view preferences', () => {
  /**
   * Loads a fresh copy of the store over a stored record.
   *
   * @param stored - What the view key holds.
   * @returns The store's initial state.
   */
  async function loadWith(stored: unknown): Promise<ReturnType<typeof useEditorStore.getState>> {
    vi.resetModules();
    const persist = await import('@/lib/persist');
    vi.mocked(persist.loadValue).mockReturnValueOnce(stored);
    const fresh = await import('@/stores/useEditorStore');
    return fresh.useEditorStore.getInitialState();
  }

  it('keeps a steps strip hidden before the timeline existed hidden', async () => {
    const state = await loadWith({ showPixelGrid: false, showStepsStrip: false });
    expect(state.bottomPanel).toBeNull();
    expect(state.showPixelGrid).toBe(false);
    expect('showStepsStrip' in state).toBe(false);
  });

  it('shows the steps for an older record that had the strip on', async () => {
    expect((await loadWith({ showStepsStrip: true })).bottomPanel).toBe('steps');
  });

  it('reads a stored bottom panel, and falls back on one it does not know', async () => {
    expect((await loadWith({ bottomPanel: 'timeline' })).bottomPanel).toBe('timeline');
    expect((await loadWith({ bottomPanel: null })).bottomPanel).toBeNull();
    expect((await loadWith({ bottomPanel: 'sideways' })).bottomPanel).toBe('steps');
  });
});
