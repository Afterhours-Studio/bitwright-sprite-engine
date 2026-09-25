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
 * The animation bridge says the names the shell expects.
 *
 * Like the export bridge, every function is one call naming a command and its
 * argument keys, and a mismatch with the Rust side only shows at run time as
 * `invalid args`. So these tests assert the literal strings on the wire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  animationRead,
  animationSetDuration,
  animationSetPlayback,
  exportGif,
  frameAdd,
  frameDelete,
  frameMove,
  frameSetDuration,
  onAnimationChanged,
} from '@/lib/animation';
import type { Animation, AnimationEvent } from '@/types/animation';

vi.mock('@/lib/tauri', () => ({ invoke: vi.fn(), on: vi.fn() }));

const tauri = await import('@/lib/tauri');

const ANIMATION: Animation = {
  rootId: 'asset-1',
  playback: 'forward',
  frames: [
    {
      assetId: 'asset-1',
      position: 0,
      durationMs: 125,
      name: 'hero',
      step: 'flats',
      updatedAt: 1,
    },
  ],
};

beforeEach(() => {
  vi.mocked(tauri.invoke).mockReset();
  vi.mocked(tauri.invoke).mockResolvedValue({ ok: true, value: ANIMATION } as never);
  vi.mocked(tauri.on).mockReset();
});

describe('animation commands', () => {
  it.each([
    ['animation_read', () => animationRead('asset-1'), { assetId: 'asset-1' }],
    ['frame_add', () => frameAdd('asset-1', true), { assetId: 'asset-1', copy: true }],
    ['frame_delete', () => frameDelete('asset-1'), { assetId: 'asset-1' }],
    ['frame_move', () => frameMove('asset-1', 2), { assetId: 'asset-1', to: 2 }],
    ['frame_set_duration', () => frameSetDuration('asset-1', 80), { assetId: 'asset-1', ms: 80 }],
    [
      'animation_set_duration',
      () => animationSetDuration('asset-1', 100),
      { assetId: 'asset-1', ms: 100 },
    ],
    [
      'animation_set_playback',
      () => animationSetPlayback('asset-1', 'pingpong'),
      { assetId: 'asset-1', mode: 'pingpong' },
    ],
  ] as const)('%s sends its arguments by their camelCase names', async (command, call, args) => {
    await expect(call()).resolves.toEqual({ ok: true, value: ANIMATION });
    expect(tauri.invoke).toHaveBeenCalledWith(command, args);
  });
});

describe('exportGif', () => {
  it('sends the folder, scale, pattern and overwrite switch by their camelCase names', async () => {
    await exportGif('asset-1', 'D:/exports', 4, '{asset}@{scale}x', true);
    expect(tauri.invoke).toHaveBeenCalledWith('export_gif', {
      assetId: 'asset-1',
      directory: 'D:/exports',
      scale: 4,
      pattern: '{asset}@{scale}x',
      overwrite: true,
    });
  });
});

describe('onAnimationChanged', () => {
  it('listens on document://animation and hands the payload through', async () => {
    const unlisten = vi.fn();
    vi.mocked(tauri.on).mockResolvedValue(unlisten);
    const handler = vi.fn();

    await expect(onAnimationChanged(handler)).resolves.toBe(unlisten);

    expect(tauri.on).toHaveBeenCalledWith('document://animation', handler);
    const event: AnimationEvent = { rootId: 'asset-1', animation: ANIMATION };
    const forwarded = vi.mocked(tauri.on).mock.calls[0]?.[1] as (payload: AnimationEvent) => void;
    forwarded(event);
    expect(handler).toHaveBeenCalledWith(event);
  });
});
