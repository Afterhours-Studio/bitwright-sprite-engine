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
 * The stage's tool dispatch: which press becomes which batch.
 *
 * The document store's `write` is replaced with a spy, so each test reads the
 * exact batch a gesture would have sent to `document_write_ops`. The bridge is
 * mocked so the composite request never settles: the picture is Rust's, and
 * what is under test here is only what the pointer asks Rust to do.
 *
 * jsdom measures nothing, so the stage is given a size by mocking the hook
 * that measures it. At 224 by 224 CSS pixels with the fit margin, an 8 by 8
 * sprite fits at 14x and its top left corner sits at (56, 56).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Tauri from '@/lib/tauri';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof Tauri>()),
  invoke: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => ({ ref: () => undefined, width: 224, height: 224 }),
}));

import { DocumentCanvas } from '@/features/editor/canvas/DocumentCanvas';
import { invoke } from '@/lib/tauri';
import { rectSelection } from '@/lib/selection';
import { resources } from '@/lib/i18n';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import type { Animation } from '@/types/animation';
import type { Asset, Layer, Op, RgbaImage, StepState } from '@/types/document';

const en = resources.en.editor.canvas;

// jsdom has no PointerEvent, and without one Testing Library builds a plain
// Event that drops the coordinates, so every press would land on NaN.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

/** The sprite's size. */
const SIZE = 8;
/** Screen pixels per sprite pixel at the fitted zoom. */
const ZOOM = 14;
/** Where the sprite's corner is on the stage. */
const ORIGIN = 56;

/** The write spy, reset per test. */
let write: ReturnType<typeof vi.fn<(ops: Op[]) => Promise<void>>>;

/**
 * The flats layer with a few pixels painted.
 *
 * @param painted - Pixels as `[x, y, slot]`.
 * @returns The layer.
 */
function flats(painted: [number, number, number][] = []): Layer {
  const data = new Array<number>(SIZE * SIZE).fill(0);
  for (const [x, y, slot] of painted) {
    data[y * SIZE + x] = slot;
  }
  return {
    id: 'layer-flats',
    role: 'flats',
    ordinal: 20,
    visible: true,
    locked: false,
    opacity: 1,
    buffer: { width: SIZE, height: SIZE, data },
  };
}

/**
 * Opens a sprite on a step.
 *
 * @param step - The workflow step.
 * @param layers - The document's layers.
 */
function open(step: StepState['step'], layers: Layer[] = [flats()]): void {
  const asset: Asset = {
    id: 'asset-1',
    projectId: 'project-1',
    styleId: null,
    name: 'Knight',
    kind: 'character',
    width: SIZE,
    height: SIZE,
    step,
    createdAt: 0,
    updatedAt: 0,
    rootId: null,
    frames: 1,
  };
  useDocumentStore.setState({
    assetId: asset.id,
    asset,
    layers,
    palette: { slots: [], ramps: [] },
    step: { assetId: asset.id, step, canAdvance: false } as StepState,
    write,
    error: null,
    seq: 0,
  });
}

/**
 * Where a sprite pixel's centre is, in client coordinates.
 *
 * @param x - Column.
 * @param y - Row.
 * @returns The pointer position.
 */
function at(x: number, y: number): { clientX: number; clientY: number } {
  return { clientX: ORIGIN + x * ZOOM + ZOOM / 2, clientY: ORIGIN + y * ZOOM + ZOOM / 2 };
}

/**
 * Drags across the stage from one sprite pixel to another.
 *
 * @param from - Where the press lands.
 * @param to - Where the release happens.
 * @param button - 0 for the left button, 2 for the right.
 */
function drag(from: [number, number], to: [number, number], button = 0): void {
  const stage = screen.getByTestId('stage');
  fireEvent.pointerDown(stage, { ...at(...from), button, pointerId: 1 });
  fireEvent.pointerMove(stage, {
    ...at(...to),
    button,
    buttons: button === 2 ? 2 : 1,
    pointerId: 1,
  });
  fireEvent.pointerUp(stage, { ...at(...to), button, pointerId: 1 });
}

beforeEach(() => {
  write = vi.fn<(ops: Op[]) => Promise<void>>(() => Promise.resolve());
  useEditorStore.setState({
    tool: 'pencil',
    slot: 3,
    secondarySlot: 5,
    brushSize: 1,
    brushShape: 'circle',
    shapeFill: false,
    symmetry: 'off',
    selection: null,
    targetRole: null,
    tileGuide: 0,
  });
});

describe('DocumentCanvas', () => {
  it('commits a pencil drag as one set_pixels batch on the step layer', () => {
    open('flats');
    render(<DocumentCanvas />);

    drag([1, 1], [3, 1]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'set_pixels',
        layer: 'flats',
        pixels: [1, 2, 3].map((x) => ({ x, y: 1, slot: 3 })),
      },
    ]);
  });

  it('mirrors a stroke when symmetry is on', () => {
    open('flats');
    useEditorStore.setState({ symmetry: 'horizontal' });
    render(<DocumentCanvas />);

    drag([1, 2], [1, 2]);

    expect(write.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'set_pixels',
        layer: 'flats',
        pixels: [
          { x: 1, y: 2, slot: 3 },
          { x: 6, y: 2, slot: 3 },
        ],
      },
    ]);
  });

  it('fills with the secondary slot on a right click', () => {
    open('flats');
    useEditorStore.setState({ tool: 'fill' });
    render(<DocumentCanvas />);

    drag([2, 2], [2, 2], 2);

    expect(write.mock.calls[0]?.[0]).toEqual([
      { kind: 'fill_region', layer: 'flats', x: 2, y: 2, slot: 5, contiguous: true },
    ]);
  });

  it('picks the slot under the cursor into primary, and into secondary on a right click', () => {
    open('flats', [
      flats([
        [4, 4, 9],
        [5, 4, 11],
      ]),
    ]);
    useEditorStore.setState({ tool: 'eyedropper' });
    render(<DocumentCanvas />);

    drag([4, 4], [4, 4]);
    drag([5, 4], [5, 4], 2);
    drag([0, 0], [0, 0]);

    // The last press was on a transparent pixel, which picks nothing.
    expect(useEditorStore.getState().slot).toBe(9);
    expect(useEditorStore.getState().secondarySlot).toBe(11);
    expect(write).not.toHaveBeenCalled();
  });

  it('selects with the wand and clears the selected pixels on Delete', () => {
    open('flats', [
      flats([
        [0, 0, 4],
        [1, 0, 4],
        [3, 0, 4],
      ]),
    ]);
    useEditorStore.setState({ tool: 'wand' });
    render(<DocumentCanvas />);

    drag([0, 0], [0, 0]);
    const selection = useEditorStore.getState().selection;
    expect(selection?.mask.slice(0, 4)).toEqual(new Uint8Array([1, 1, 0, 0]));
    expect(screen.getByTestId('selection-outline')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(write.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'set_pixels',
        layer: 'flats',
        pixels: [
          { x: 0, y: 0, slot: 0 },
          { x: 1, y: 0, slot: 0 },
        ],
      },
    ]);
  });

  it('makes a rectangle selection and drops it on Escape', () => {
    open('flats');
    useEditorStore.setState({ tool: 'select' });
    render(<DocumentCanvas />);

    drag([1, 1], [2, 3]);
    const mask = useEditorStore.getState().selection?.mask;
    expect(mask?.reduce((sum, value) => sum + value, 0)).toBe(6);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('translates the layer on a move with no selection', () => {
    open('flats');
    useEditorStore.setState({ tool: 'move' });
    render(<DocumentCanvas />);

    drag([1, 1], [3, 2]);

    expect(write.mock.calls[0]?.[0]).toEqual([{ kind: 'translate', layer: 'flats', dx: 2, dy: 1 }]);
  });

  it('moves a selection, lifting its pixels in one batch, and the selection follows', async () => {
    open('flats', [flats([[0, 0, 4]])]);
    useEditorStore.setState({
      tool: 'move',
      selection: {
        ...rectSelection({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: SIZE, height: SIZE }),
        assetId: 'asset-1',
      },
    });
    render(<DocumentCanvas />);

    drag([0, 0], [1, 0]);

    expect(write.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'set_pixels',
        layer: 'flats',
        pixels: [
          { x: 0, y: 0, slot: 0 },
          { x: 1, y: 0, slot: 4 },
        ],
      },
    ]);
    // Only once the write has landed.
    await act(async () => {
      await Promise.resolve();
    });
    expect(useEditorStore.getState().selection?.mask[1]).toBe(1);
  });

  it('sends a shape as draw_shape with the fill setting', () => {
    open('flats');
    useEditorStore.setState({ tool: 'rectangle', shapeFill: true });
    render(<DocumentCanvas />);

    drag([1, 1], [4, 4]);

    expect(write.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'draw_shape',
        layer: 'flats',
        shape: 'rect',
        from: { x: 1, y: 1 },
        to: { x: 4, y: 4 },
        slot: 3,
        fill: true,
        pixelPerfect: true,
      },
    ]);
  });

  it('flips the active layer as a whole-layer mirror', () => {
    open('flats');
    render(<DocumentCanvas />);

    fireEvent.click(screen.getByRole('button', { name: en.flipHorizontal }));
    // The second waits for the first to come back through document://changed.
    act(() => {
      useDocumentStore.setState({ seq: 1 });
    });
    fireEvent.click(screen.getByRole('button', { name: en.flipVertical }));

    expect(write.mock.calls.map((call) => call[0])).toEqual([
      [{ kind: 'mirror', layer: 'flats', axis: 'x' }],
      [{ kind: 'mirror', layer: 'flats', axis: 'y' }],
    ]);
  });

  it('replaces every secondary pixel with the primary', () => {
    open('flats', [
      flats([
        [2, 2, 5],
        [3, 3, 7],
      ]),
    ]);
    render(<DocumentCanvas />);

    fireEvent.click(screen.getByRole('button', { name: en.replaceSecondary }));

    expect(write.mock.calls[0]?.[0]).toEqual([
      { kind: 'set_pixels', layer: 'flats', pixels: [{ x: 2, y: 2, slot: 3 }] },
    ]);
  });

  it('refuses a stroke on a step that paints nothing, and says why', () => {
    open('cleanup');
    render(<DocumentCanvas />);

    drag([1, 1], [2, 1]);

    expect(write).not.toHaveBeenCalled();
    expect(screen.getByText(en.stepPaintsNothing)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.flipHorizontal })).toBeDisabled();
  });

  it('reads out the cursor pixel, the size and the zoom', () => {
    open('flats');
    render(<DocumentCanvas />);
    const readout = screen.getByTestId('canvas-readout');

    expect(readout).toHaveTextContent('-- : --');
    expect(readout).toHaveTextContent('8 x 8 px');
    expect(readout).toHaveTextContent('14 x');

    fireEvent.pointerMove(screen.getByTestId('stage'), { ...at(5, 6), pointerId: 1 });
    expect(readout).toHaveTextContent('5 : 6');
  });

  it('zooms with the minus key, but not while typing into a field', () => {
    open('flats');
    render(
      <>
        <input aria-label="name" />
        <DocumentCanvas />
      </>,
    );
    const percent = screen.getByRole('button', { name: en.zoomFitHint });
    expect(percent).toHaveTextContent('1400 %');

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'name' }), { key: '-' });
    expect(percent).toHaveTextContent('1400 %');

    fireEvent.keyDown(window, { key: '-' });
    expect(percent).toHaveTextContent('700 %');

    // The percentage is the way back to the fitted view.
    fireEvent.click(percent);
    expect(percent).toHaveTextContent('1400 %');
  });

  it('pans instead of painting while Space is held', () => {
    open('flats');
    render(<DocumentCanvas />);

    act(() => {
      fireEvent.keyDown(window, { key: ' ' });
    });
    drag([1, 1], [3, 1]);
    fireEvent.keyUp(window, { key: ' ' });

    expect(write).not.toHaveBeenCalled();
  });

  it('ignores and drops a selection made on another asset', () => {
    open('flats');
    useEditorStore.setState({
      selection: {
        ...rectSelection({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: SIZE, height: SIZE }),
        assetId: 'asset-other',
      },
    });
    render(<DocumentCanvas />);

    expect(useEditorStore.getState().selection).toBeNull();
    drag([3, 3], [3, 3]);
    expect(write.mock.calls[0]?.[0]).toEqual([
      { kind: 'set_pixels', layer: 'flats', pixels: [{ x: 3, y: 3, slot: 3 }] },
    ]);
  });

  it('makes no selection from a marquee wholly off the sprite', () => {
    open('flats');
    useEditorStore.setState({ tool: 'select' });
    render(<DocumentCanvas />);

    drag([-3, -3], [-1, -2]);

    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('does not let a mouse press leave focus on a panel button', () => {
    open('flats');
    render(<DocumentCanvas />);

    // A prevented mouse down is what keeps focus off the button, so the next
    // Space is the hand's rather than a second flip.
    const flip = screen.getByRole('button', { name: en.flipHorizontal });
    expect(fireEvent.mouseDown(flip)).toBe(false);
  });

  it('ends a drag whose release was lost, keeping what it drew', () => {
    open('flats');
    render(<DocumentCanvas />);
    const stage = screen.getByTestId('stage');

    fireEvent.pointerDown(stage, { ...at(1, 1), button: 0, pointerId: 1 });
    fireEvent.pointerMove(stage, { ...at(2, 1), buttons: 1, pointerId: 1 });
    // Another pointer while the drag is under way is not part of it.
    fireEvent.pointerDown(stage, { ...at(6, 6), button: 0, pointerId: 2 });
    fireEvent.pointerMove(stage, { ...at(3, 1), buttons: 0, pointerId: 1 });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toEqual([
      {
        kind: 'set_pixels',
        layer: 'flats',
        pixels: [
          { x: 1, y: 1, slot: 3 },
          { x: 2, y: 1, slot: 3 },
        ],
      },
    ]);
  });

  it('discards a cancelled stroke', () => {
    open('flats');
    render(<DocumentCanvas />);
    const stage = screen.getByTestId('stage');

    fireEvent.pointerDown(stage, { ...at(1, 1), button: 0, pointerId: 1 });
    fireEvent.pointerMove(stage, { ...at(3, 1), buttons: 1, pointerId: 1 });
    fireEvent.pointerCancel(stage, { pointerId: 1 });
    fireEvent.pointerUp(stage, { ...at(3, 1), pointerId: 1 });

    expect(write).not.toHaveBeenCalled();
  });

  it('waits for a write to land before starting the next stroke', () => {
    open('flats');
    render(<DocumentCanvas />);

    drag([1, 1], [1, 1]);
    drag([2, 2], [2, 2]);
    expect(write).toHaveBeenCalledTimes(1);

    act(() => {
      useDocumentStore.setState({ seq: 1 });
    });
    drag([2, 2], [2, 2]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('leaves the selection where it was when the move is refused', async () => {
    open('flats', [flats([[0, 0, 4]])]);
    write.mockImplementation(() => {
      useDocumentStore.setState({ error: 'document.layer_locked' });
      return Promise.resolve();
    });
    useEditorStore.setState({
      tool: 'move',
      selection: {
        ...rectSelection({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: SIZE, height: SIZE }),
        assetId: 'asset-1',
      },
    });
    render(<DocumentCanvas />);

    drag([0, 0], [1, 0]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(useEditorStore.getState().selection?.mask[0]).toBe(1);
    expect(useEditorStore.getState().selection?.mask[1]).toBe(0);
  });

  it('clears once for a held Delete key', () => {
    open('flats', [flats([[0, 0, 4]])]);
    useEditorStore.setState({
      selection: {
        ...rectSelection({ x: 0, y: 0 }, { x: 1, y: 0 }, { width: SIZE, height: SIZE }),
        assetId: 'asset-1',
      },
    });
    render(<DocumentCanvas />);

    fireEvent.keyDown(window, { key: 'Delete', repeat: true });
    expect(write).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('zooms one rung per notch of wheel travel, and not at all for a sideways scroll', () => {
    open('flats');
    render(<DocumentCanvas />);
    const stage = screen.getByTestId('stage');
    const percent = screen.getByRole('button', { name: en.zoomFitHint });

    fireEvent.wheel(stage, { deltaY: 0, deltaX: 30 });
    expect(percent).toHaveTextContent('1400 %');

    // A trackpad's small deltas add up to one rung rather than one each.
    for (let tick = 0; tick < 4; tick += 1) {
      fireEvent.wheel(stage, { deltaY: -30, ...at(4, 4) });
    }
    expect(percent).toHaveTextContent('2800 %');
  });
});

describe('DocumentCanvas with an animation', () => {
  /** The store's own `select`, put back after a test replaces it. */
  const realSelect = useAnimationStore.getState().select;

  /** An opaque picture of the sprite's size, as `document_composite` returns. */
  const picture: RgbaImage = {
    width: SIZE,
    height: SIZE,
    data: new Array<number>(SIZE * SIZE * 4).fill(255),
  };

  /**
   * Frames around the open sprite. Each test names its own, because the
   * frame pictures are cached by id for the life of the module.
   *
   * @param ids - The frames in order; `asset-1` is the open one.
   * @returns The animation.
   */
  function animationOf(ids: string[]): Animation {
    return {
      rootId: ids[0] ?? 'asset-1',
      playback: 'forward',
      frames: ids.map((assetId, position) => ({
        assetId,
        position,
        durationMs: 125,
        name: `Knight #${String(position + 1)}`,
        step: 'flats',
        updatedAt: 1,
      })),
    };
  }

  /** The asset ids `document_composite` was asked for. */
  function composited(): unknown[] {
    return vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'document_composite')
      .map(([, args]) => (args as { assetId: string }).assetId);
  }

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    // Every frame but the open one answers; the open one's composite stays
    // pending, so what is on the stage is only ever another frame's picture.
    vi.mocked(invoke).mockImplementation((command, args) => {
      const id = (args as { assetId?: string } | undefined)?.assetId;
      if (command === 'document_composite' && id !== 'asset-1') {
        return Promise.resolve({ ok: true, value: picture });
      }
      return new Promise(() => undefined);
    });
    useAnimationStore.setState({
      animation: null,
      playing: false,
      playhead: 0,
      onionSkin: false,
      select: realSelect,
    });
  });

  it('draws the previous frame at 30% and the next at 15% under the open one, in the sprite box', async () => {
    open('flats');
    useAnimationStore.setState({
      animation: animationOf(['onion-prev', 'asset-1', 'onion-next']),
      onionSkin: true,
    });
    render(<DocumentCanvas />);

    const ghosts = await screen.findAllByTestId('onion-skin');
    expect(ghosts).toHaveLength(2);
    expect(ghosts.map((ghost) => ghost.style.opacity)).toEqual(['0.3', '0.15']);
    // Stretched to the sprite's drawn size, inside the box that pans and zooms.
    expect(ghosts[0]?.style.width).toBe(`${String(SIZE * ZOOM)}px`);
    expect(ghosts[0]?.parentElement?.style.left).toBe(`${String(ORIGIN)}px`);
    expect(composited()).toEqual(expect.arrayContaining(['onion-prev', 'onion-next']));

    // Zooming moves the ghosts with the sprite, because they are in its box.
    fireEvent.keyDown(window, { key: '-' });
    expect(ghosts[0]?.style.width).toBe(`${String((SIZE * ZOOM) / 2)}px`);
  });

  it('draws no previous frame on the first, and nothing with the onion skin off', async () => {
    open('flats');
    useAnimationStore.setState({
      animation: animationOf(['asset-1', 'first-next']),
      onionSkin: true,
    });
    const { unmount } = render(<DocumentCanvas />);
    const ghosts = await screen.findAllByTestId('onion-skin');
    expect(ghosts.map((ghost) => ghost.style.opacity)).toEqual(['0.15']);
    unmount();

    vi.mocked(invoke).mockClear();
    useAnimationStore.setState({
      animation: animationOf(['off-prev', 'asset-1']),
      onionSkin: false,
    });
    render(<DocumentCanvas />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('onion-skin')).not.toBeInTheDocument();
    expect(composited()).not.toContain('off-prev');
  });

  it('shows the playhead frame while playing, draws nothing, and still zooms', async () => {
    open('flats');
    useAnimationStore.setState({
      animation: animationOf(['play-a', 'asset-1', 'play-c']),
      onionSkin: true,
      playing: true,
      playhead: 2,
    });
    render(<DocumentCanvas />);

    // The open frame's own composite never answers, so a surface on the stage
    // is the playhead frame's picture.
    expect(await screen.findByRole('img', { name: en.surface })).toBeInTheDocument();
    expect(composited()).toEqual(expect.arrayContaining(['play-a', 'play-c']));
    expect(screen.queryByTestId('onion-skin')).not.toBeInTheDocument();
    expect(screen.getByTestId('canvas-readout')).toHaveTextContent(en.playing);

    drag([1, 1], [3, 1]);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: en.flipHorizontal })).toBeDisabled();

    const percent = screen.getByRole('button', { name: en.zoomFitHint });
    act(() => {
      useEditorStore.setState({ tool: 'zoom' });
    });
    fireEvent.pointerDown(screen.getByTestId('stage'), { ...at(4, 4), button: 0, pointerId: 1 });
    expect(percent).toHaveTextContent('2800 %');

    act(() => {
      useAnimationStore.setState({ playing: false });
      useEditorStore.setState({ tool: 'pencil' });
    });
    expect(screen.getByTestId('canvas-readout')).not.toHaveTextContent(en.playing);
  });

  it('steps frames with comma and full stop, round the ends, but not while typing', () => {
    open('flats');
    const select = vi.fn(() => Promise.resolve());
    useAnimationStore.setState({ animation: animationOf(['keys-a', 'asset-1', 'keys-c']), select });
    render(
      <>
        <input aria-label="name" />
        <DocumentCanvas />
      </>,
    );

    fireEvent.keyDown(window, { key: '.' });
    expect(select).toHaveBeenLastCalledWith('keys-c');
    fireEvent.keyDown(window, { key: ',' });
    expect(select).toHaveBeenLastCalledWith('keys-a');

    select.mockClear();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'name' }), { key: '.' });
    expect(select).not.toHaveBeenCalled();

    act(() => {
      useAnimationStore.setState({ animation: animationOf(['asset-1', 'keys-z']) });
    });
    fireEvent.keyDown(window, { key: ',' });
    expect(select).toHaveBeenLastCalledWith('keys-z');
  });
});
