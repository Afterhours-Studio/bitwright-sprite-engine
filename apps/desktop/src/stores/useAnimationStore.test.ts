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
 * The animation store: which frame each action opens, and the order playback
 * walks the frames in.
 *
 * Playback order is the part worth pinning down with fake timers, because a
 * ping-pong that repeats its ends, or a timer that ignores a frame's own
 * duration, looks almost right on screen and is wrong in every exported GIF
 * compared against it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import type { Animation, AnimationEvent, Playback } from '@/types/animation';
import type { Asset } from '@/types/document';

import type { ShellResult } from '@/lib/tauri';

vi.mock('@/lib/animation', () => ({
  animationRead: vi.fn(),
  frameAdd: vi.fn(),
  frameDelete: vi.fn(),
  frameMove: vi.fn(),
  frameSetDuration: vi.fn(),
  animationSetDuration: vi.fn(),
  animationSetPlayback: vi.fn(),
  onAnimationChanged: vi.fn(),
}));

vi.mock('@/lib/tauri', () => ({
  invoke: vi.fn(() =>
    Promise.resolve({ ok: false, error: { code: 'shell.unavailable', detail: '' } }),
  ),
  on: vi.fn(() => Promise.resolve(() => {})),
}));

const bridge = await import('@/lib/animation');

/**
 * An animation of frames `f0`, `f1`, ... with the given durations.
 *
 * @param durations - One per frame, in order.
 * @param playback - The playback mode.
 * @returns The animation, rooted at `f0`.
 */
function animation(durations: number[], playback: Playback = 'forward'): Animation {
  return {
    rootId: 'f0',
    playback,
    frames: durations.map((durationMs, position) => ({
      assetId: `f${String(position)}`,
      position,
      durationMs,
      name: position === 0 ? 'hero' : `hero #${String(position + 1)}`,
      step: 'flats',
      updatedAt: 1,
    })),
  };
}

/**
 * The asset row of frame `id`.
 *
 * @param id - The frame's asset id.
 * @returns The row.
 */
function row(id: string): Asset {
  return {
    id,
    projectId: 'project-1',
    styleId: null,
    name: id,
    kind: 'character',
    width: 16,
    height: 16,
    step: 'flats',
    createdAt: 1,
    updatedAt: 1,
    rootId: id === 'f0' ? null : 'f0',
    frames: id === 'f0' ? 3 : 0,
  };
}

/**
 * Makes a bridge function answer with an animation.
 *
 * @param fn - The mocked function.
 * @param value - The animation it returns.
 */
function answers(
  fn: (...args: never[]) => Promise<ShellResult<Animation>>,
  value: Animation,
): void {
  vi.mocked(fn).mockResolvedValue({ ok: true, value });
}

/** Lets pending promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

const openAsset = vi.fn((asset: Asset) => {
  useDocumentStore.setState({ assetId: asset.id });
  return Promise.resolve();
});
const selectAsset = vi.fn((id: string | null) => {
  useDocumentStore.setState({ assetId: id });
  return Promise.resolve();
});
const loadAll = vi.fn(() => Promise.resolve());

let emit: (event: AnimationEvent) => void = () => {};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(bridge.onAnimationChanged).mockImplementation((handler) => {
    emit = handler;
    return Promise.resolve(() => {});
  });
  answers(bridge.animationRead, animation([100, 100, 100]));
  useProjectStore.setState({
    allAssets: ['f0', 'f1', 'f2', 'f3'].map(row),
    assets: [],
    openAsset,
    selectAsset,
    loadAll,
  });
  useDocumentStore.setState({ assetId: null });
  useAnimationStore.getState().dispose();
  useToastStore.getState().dismissAll();
  await useAnimationStore.getState().subscribe();
});

afterEach(() => {
  useAnimationStore.getState().dispose();
  vi.useRealTimers();
});

/**
 * Opens frame `id` and waits for the animation read it triggers.
 *
 * @param id - The frame to open.
 */
async function openFrame(id: string): Promise<void> {
  useDocumentStore.setState({ assetId: id });
  await settle();
}

describe('following the document', () => {
  it('loads the animation of whatever document opens, and clears when it closes', async () => {
    await openFrame('f1');

    expect(bridge.animationRead).toHaveBeenCalledWith('f1');
    expect(useAnimationStore.getState().animation?.frames).toHaveLength(3);
    expect(useAnimationStore.getState().playhead).toBe(1);

    useDocumentStore.setState({ assetId: null });
    expect(useAnimationStore.getState().animation).toBeNull();
  });

  it('adopts document://animation for the animation it shows, and ignores others', async () => {
    await openFrame('f0');

    const other: Animation = {
      rootId: 'other',
      playback: 'forward',
      frames: [
        {
          assetId: 'other',
          position: 0,
          durationMs: 50,
          name: 'other',
          step: 'flats',
          updatedAt: 1,
        },
      ],
    };
    emit({ rootId: 'other', animation: other });
    expect(useAnimationStore.getState().animation?.frames).toHaveLength(3);

    emit({ rootId: 'f0', animation: animation([100, 100, 100, 100]) });
    expect(useAnimationStore.getState().animation?.frames).toHaveLength(4);
  });

  it('raises a toast with the error code when a read is refused', async () => {
    vi.mocked(bridge.animationRead).mockResolvedValue({
      ok: false,
      error: { code: 'animation.last_frame', detail: '' },
    });
    await openFrame('f0');

    expect(useAnimationStore.getState().error).toBe('animation.last_frame');
    expect(useToastStore.getState().visible[0]?.messageKey).toBe('errors:animation.last_frame');
  });
});

describe('frame actions', () => {
  it('add inserts after the open frame, refreshes the lists and opens the new frame', async () => {
    await openFrame('f1');
    const grown = animation([100, 100, 100, 100]);
    answers(bridge.frameAdd, grown);

    await useAnimationStore.getState().add(true);

    expect(bridge.frameAdd).toHaveBeenCalledWith('f1', true);
    expect(loadAll).toHaveBeenCalled();
    expect(openAsset).toHaveBeenCalledWith(row('f2'));
  });

  it('remove of the open frame opens the neighbour that takes its place', async () => {
    await openFrame('f1');
    const shrunk: Animation = {
      ...animation([100, 100]),
      frames: animation([100, 100, 100]).frames.filter((frame) => frame.assetId !== 'f1'),
    };
    answers(bridge.frameDelete, shrunk);

    await useAnimationStore.getState().remove('f1');

    expect(bridge.frameDelete).toHaveBeenCalledWith('f1');
    expect(openAsset).toHaveBeenCalledWith(row('f2'));
  });

  it('remove of the last open frame opens the new last one', async () => {
    await openFrame('f2');
    answers(bridge.frameDelete, animation([100, 100]));

    await useAnimationStore.getState().remove('f2');

    expect(openAsset).toHaveBeenCalledWith(row('f1'));
  });

  it('remove of another frame keeps the open one', async () => {
    await openFrame('f0');
    answers(bridge.frameDelete, animation([100, 100]));

    await useAnimationStore.getState().remove('f2');

    expect(loadAll).toHaveBeenCalled();
    expect(openAsset).not.toHaveBeenCalled();
  });

  it('refuses through a toast, keeping the animation it had', async () => {
    await openFrame('f0');
    vi.mocked(bridge.frameDelete).mockResolvedValue({
      ok: false,
      error: { code: 'animation.last_frame', detail: '' },
    });

    await useAnimationStore.getState().remove('f0');

    expect(useAnimationStore.getState().animation?.frames).toHaveLength(3);
    expect(useToastStore.getState().visible[0]?.messageKey).toBe('errors:animation.last_frame');
    expect(openAsset).not.toHaveBeenCalled();
  });

  it('select opens that frame through the project store', async () => {
    await openFrame('f0');

    await useAnimationStore.getState().select('f2');

    expect(openAsset).toHaveBeenCalledWith(row('f2'));
  });

  it('setFps sets every frame to the rounded duration', async () => {
    await openFrame('f1');
    answers(bridge.animationSetDuration, animation([83, 83, 83]));

    await useAnimationStore.getState().setFps(12);

    expect(bridge.animationSetDuration).toHaveBeenCalledWith('f1', 83);
  });

  it('move, setDuration and setPlayback pass their arguments through', async () => {
    await openFrame('f0');
    answers(bridge.frameMove, animation([100, 100, 100]));
    answers(bridge.frameSetDuration, animation([100, 40, 100]));
    answers(bridge.animationSetPlayback, animation([100, 100, 100], 'pingpong'));

    await useAnimationStore.getState().move('f2', 0);
    await useAnimationStore.getState().setDuration('f1', 40);
    await useAnimationStore.getState().setPlayback('pingpong');

    expect(bridge.frameMove).toHaveBeenCalledWith('f2', 0);
    expect(bridge.frameSetDuration).toHaveBeenCalledWith('f1', 40);
    expect(bridge.animationSetPlayback).toHaveBeenCalledWith('f0', 'pingpong');
    expect(useAnimationStore.getState().animation?.playback).toBe('pingpong');
  });
});

describe('onion skin', () => {
  it('toggles and remembers the choice', () => {
    const before = useAnimationStore.getState().onionSkin;

    useAnimationStore.getState().toggleOnionSkin();

    expect(useAnimationStore.getState().onionSkin).toBe(!before);
    expect(window.localStorage.getItem('bitwright.onionSkin')).toBe(JSON.stringify(!before));
  });
});

describe('playback', () => {
  /**
   * Plays from frame `start` and records the playhead after each step.
   *
   * @param durations - Each frame's duration.
   * @param mode - The playback mode.
   * @param start - The open frame's index.
   * @param steps - How many steps to record.
   * @returns The playhead after each step.
   */
  async function playOrder(
    durations: number[],
    mode: Playback,
    start: number,
    steps: number,
  ): Promise<number[]> {
    answers(bridge.animationRead, animation(durations, mode));
    await openFrame(`f${String(start)}`);
    vi.useFakeTimers();
    useAnimationStore.getState().play();
    const seen: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      const current = useAnimationStore.getState().playhead;
      vi.advanceTimersByTime(durations[current] ?? 0);
      seen.push(useAnimationStore.getState().playhead);
    }
    return seen;
  }

  it('forward walks up and wraps to the first frame', async () => {
    expect(await playOrder([100, 100, 100], 'forward', 1, 5)).toEqual([2, 0, 1, 2, 0]);
  });

  it('reverse walks down and wraps to the last frame', async () => {
    expect(await playOrder([100, 100, 100], 'reverse', 1, 5)).toEqual([0, 2, 1, 0, 2]);
  });

  it('pingpong bounces off each end without repeating it', async () => {
    expect(await playOrder([100, 100, 100, 100], 'pingpong', 0, 8)).toEqual([
      1, 2, 3, 2, 1, 0, 1, 2,
    ]);
  });

  it('pingpong started on the last frame turns back at once', async () => {
    expect(await playOrder([100, 100, 100], 'pingpong', 2, 4)).toEqual([1, 0, 1, 2]);
  });

  it('waits each frame out for its own duration', async () => {
    answers(bridge.animationRead, animation([100, 300, 50]));
    await openFrame('f0');
    vi.useFakeTimers();
    useAnimationStore.getState().play();

    vi.advanceTimersByTime(99);
    expect(useAnimationStore.getState().playhead).toBe(0);
    vi.advanceTimersByTime(1);
    expect(useAnimationStore.getState().playhead).toBe(1);
    vi.advanceTimersByTime(299);
    expect(useAnimationStore.getState().playhead).toBe(1);
    vi.advanceTimersByTime(1);
    expect(useAnimationStore.getState().playhead).toBe(2);
    vi.advanceTimersByTime(50);
    expect(useAnimationStore.getState().playhead).toBe(0);
  });

  it('pause stops the timer and returns the playhead to the open frame', async () => {
    await openFrame('f1');
    vi.useFakeTimers();
    useAnimationStore.getState().play();
    vi.advanceTimersByTime(100);
    expect(useAnimationStore.getState().playhead).toBe(2);

    useAnimationStore.getState().pause();
    vi.advanceTimersByTime(1000);

    expect(useAnimationStore.getState().playing).toBe(false);
    expect(useAnimationStore.getState().playhead).toBe(1);
    expect(useDocumentStore.getState().assetId).toBe('f1');
  });

  it('stops when the document closes', async () => {
    await openFrame('f0');
    vi.useFakeTimers();
    useAnimationStore.getState().play();

    useDocumentStore.setState({ assetId: null });
    vi.advanceTimersByTime(1000);

    expect(useAnimationStore.getState().playing).toBe(false);
    expect(useAnimationStore.getState().playhead).toBe(0);
  });

  it('stops when the frames change underneath it, but not when a duration does', async () => {
    await openFrame('f0');
    vi.useFakeTimers();
    useAnimationStore.getState().play();

    emit({ rootId: 'f0', animation: animation([40, 40, 40]) });
    expect(useAnimationStore.getState().playing).toBe(true);

    emit({ rootId: 'f0', animation: animation([40, 40, 40, 40]) });
    expect(useAnimationStore.getState().playing).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(useAnimationStore.getState().playhead).toBe(0);
  });
});
