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
 * What the timeline strip sends to the animation store.
 *
 * The strip owns no animation, so the failure worth catching is a control
 * that calls the wrong action, or the right one with the wrong frame: a
 * duration committed to the root instead of the open frame, or a delete that
 * skips its confirmation. The store's actions are replaced with spies and the
 * bridge is mocked, so every assertion is about the call the strip made.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invoke: vi.fn(() =>
    Promise.resolve({ ok: false, error: { code: 'shell.unavailable', message: '' } }),
  ),
}));

const tauri = await import('@/lib/tauri');
import { clearFrameComposites } from '@/features/editor/timeline/frameComposites';
import { TimelineStrip } from '@/features/editor/timeline/TimelineStrip';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import type { Animation, Frame } from '@/types/animation';

/**
 * A frame of the test animation.
 *
 * @param position - Where it sits.
 * @param durationMs - How long it lasts.
 */
function frame(position: number, durationMs = 125): Frame {
  return {
    assetId: `frame-${position + 1}`,
    position,
    durationMs,
    name: position === 0 ? 'Knight' : `Knight #${position + 1}`,
    step: 'silhouette',
    updatedAt: 1000 + position,
  };
}

/** The spies standing in for the store's actions. */
const actions = {
  add: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  move: vi.fn(() => Promise.resolve()),
  setDuration: vi.fn(() => Promise.resolve()),
  setFps: vi.fn(() => Promise.resolve()),
  setPlayback: vi.fn(() => Promise.resolve()),
  play: vi.fn(),
  pause: vi.fn(),
  toggleOnionSkin: vi.fn(),
  select: vi.fn(() => Promise.resolve()),
};

/**
 * Puts an animation in the store with a frame open.
 *
 * @param frames - The frames.
 * @param open - The index of the open one.
 */
function show(frames: Frame[], open = 0): void {
  const animation: Animation = { rootId: 'frame-1', playback: 'forward', frames };
  useAnimationStore.setState({
    animation,
    playing: false,
    playhead: open,
    onionSkin: false,
    ...actions,
  });
  useDocumentStore.setState({ assetId: frames[open]?.assetId ?? null, seq: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearFrameComposites();
});

describe('TimelineStrip', () => {
  it('says there are no frames when nothing is open', () => {
    useAnimationStore.setState({ animation: null, ...actions });
    useDocumentStore.setState({ assetId: null });
    render(<TimelineStrip />);
    expect(screen.getByText(/no sprite is open/i)).toBeInTheDocument();
  });

  it('shows a lone sprite as one card, with Add and no Delete', () => {
    show([frame(0)]);
    render(<TimelineStrip />);
    const cards = within(screen.getByRole('list', { name: 'Frames' })).getAllByRole('listitem');
    // The one frame and the Add button.
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Frame 1 / 1 :')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete frame' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add a copy of the current frame' }));
    expect(actions.add).toHaveBeenCalledWith(true);
  });

  it('composites every frame through the shell', () => {
    show([frame(0), frame(1)]);
    render(<TimelineStrip />);
    const asked = vi
      .mocked(tauri.invoke)
      .mock.calls.filter(([command]) => command === 'document_composite')
      .map(([, args]) => (args as { assetId: string }).assetId);
    expect(new Set(asked)).toEqual(new Set(['frame-1', 'frame-2']));
  });

  it('names the open frame and rings its card', () => {
    show([frame(0), frame(1), frame(2)], 1);
    render(<TimelineStrip />);
    expect(screen.getByText('Frame 2 / 3 :')).toBeInTheDocument();
    expect(screen.getByText('Knight #2')).toBeInTheDocument();
    const current = screen.getByRole('button', { name: 'Open frame 2: Knight #2' }).closest('li');
    expect(current).toHaveAttribute('aria-current', 'true');
  });

  it('shows the playhead frame in the bar while playing', () => {
    show([frame(0), frame(1), frame(2)], 0);
    useAnimationStore.setState({ playing: true, playhead: 2 });
    render(<TimelineStrip />);
    expect(screen.getByText('Frame 3 / 3 :')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(actions.pause).toHaveBeenCalled();
  });

  it('sends playback, play, onion skin and duplicate to the store', () => {
    show([frame(0), frame(1)]);
    render(<TimelineStrip />);
    expect(screen.getByRole('button', { name: 'Forward' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ping-pong' }));
    expect(actions.setPlayback).toHaveBeenCalledWith('pingpong');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(actions.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Onion Skin' }));
    expect(actions.toggleOnionSkin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate frame' }));
    expect(actions.add).toHaveBeenCalledWith(true);
  });

  it('shows the FPS the open frame implies and sets it for every frame', async () => {
    show([frame(0, 125), frame(1, 50)], 1);
    render(<TimelineStrip />);
    const slider = screen.getByRole('slider', { name: /frames per second/i });
    expect(slider).toHaveValue('20');
    expect(screen.getByText('20 FPS')).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(slider, { target: { value: '12' } });
      await Promise.resolve();
    });
    expect(actions.setFps).toHaveBeenCalledWith(12);
  });

  it('commits a typed duration on Enter, clamped, to the open frame', () => {
    show([frame(0), frame(1)], 1);
    render(<TimelineStrip />);
    const field = screen.getByRole('textbox', { name: /milliseconds/i });
    expect(field).toHaveValue('125');
    fireEvent.change(field, { target: { value: '99999' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(actions.setDuration).toHaveBeenCalledWith('frame-2', 10000);
    expect(field).toHaveValue('10000');
  });

  it('commits on blur and sends nothing for an unchanged duration', () => {
    show([frame(0)]);
    render(<TimelineStrip />);
    const field = screen.getByRole('textbox', { name: /milliseconds/i });
    fireEvent.blur(field);
    expect(actions.setDuration).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.blur(field);
    expect(actions.setDuration).toHaveBeenCalledWith('frame-1', 10);
  });

  it('reverts a typed duration on Escape without sending it', () => {
    show([frame(0)]);
    render(<TimelineStrip />);
    const field = screen.getByRole('textbox', { name: /milliseconds/i });
    fireEvent.change(field, { target: { value: '400' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveValue('125');
    fireEvent.blur(field);
    expect(actions.setDuration).not.toHaveBeenCalled();
  });

  it('reverts a duration that is not a number', () => {
    show([frame(0)]);
    render(<TimelineStrip />);
    const field = screen.getByRole('textbox', { name: /milliseconds/i });
    fireEvent.change(field, { target: { value: 'fast' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveValue('125');
    expect(actions.setDuration).not.toHaveBeenCalled();
  });

  it('deletes the open frame only after the confirmation', () => {
    show([frame(0), frame(1)], 1);
    render(<TimelineStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete frame' }));
    expect(actions.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete this frame?' });
    expect(within(dialog).getByText(/Knight #2/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete frame' }));
    expect(actions.remove).toHaveBeenCalledWith('frame-2');
  });

  it('leaves the frame alone when the confirmation is cancelled', () => {
    show([frame(0), frame(1)], 1);
    render(<TimelineStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete frame' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this frame?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it('opens a frame when its card is clicked', () => {
    show([frame(0), frame(1)]);
    render(<TimelineStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'Open frame 2: Knight #2' }));
    expect(actions.select).toHaveBeenCalledWith('frame-2');
  });

  it('moves a frame left and right, but not off either end', () => {
    show([frame(0), frame(1), frame(2)]);
    render(<TimelineStrip />);
    expect(screen.getByRole('button', { name: 'Move frame 1 left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move frame 3 right' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move frame 2 left' }));
    expect(actions.move).toHaveBeenCalledWith('frame-2', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Move frame 2 right' }));
    expect(actions.move).toHaveBeenCalledWith('frame-2', 2);
  });
});
