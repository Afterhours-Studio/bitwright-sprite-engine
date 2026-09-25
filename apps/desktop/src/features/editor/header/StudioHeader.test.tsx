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
 * The editor header against real stores whose commands are replaced.
 *
 * The store actions that reach the shell (undo, redo, write, rename) are
 * swapped for spies with `setState`, so what is pinned down is what the
 * header asks for and when, not how the shell answers. The event bridge and
 * the MCP commands are mocked so the agent popover can mount without a shell.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  inShell: vi.fn(() => false),
  windowIsMaximized: vi.fn(() =>
    Promise.resolve({ ok: false, error: { code: 'shell.unavailable' } }),
  ),
  windowMinimize: vi.fn(() => Promise.resolve({ ok: true, value: null })),
  windowToggleMaximize: vi.fn(() => Promise.resolve({ ok: true, value: true })),
  windowClose: vi.fn(() => Promise.resolve({ ok: true, value: null })),
}));

vi.mock('@/lib/mcp', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  onAgentSession: vi.fn(() => Promise.resolve(vi.fn())),
  onAgentActivity: vi.fn(() => Promise.resolve(vi.fn())),
}));

const tauri = await import('@/lib/tauri');
import { StudioHeader } from '@/features/editor/header/StudioHeader';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import type { Asset, Layer, StepState } from '@/types/document';

const ASSET: Asset = {
  id: 'asset-1',
  projectId: 'project-1',
  styleId: null,
  name: 'Knight',
  kind: 'character',
  width: 24,
  height: 24,
  step: 'flats',
  createdAt: 0,
  updatedAt: 0,
  rootId: null,
  frames: 1,
};

const FLATS = { id: 'layer-1', role: 'flats', locked: false } as Layer;

const undo = vi.fn(() => Promise.resolve());
const redo = vi.fn(() => Promise.resolve());
const write = vi.fn(() => Promise.resolve());
const renameAsset = vi.fn(() => Promise.resolve());

/** Puts a sprite on the stage at the flats step, with its flats layer. */
function openSprite(): void {
  const step = { assetId: ASSET.id, step: 'flats', canAdvance: false } as StepState;
  useDocumentStore.setState({ assetId: ASSET.id, asset: ASSET, layers: [FLATS], step });
}

beforeEach(() => {
  undo.mockClear();
  redo.mockClear();
  write.mockClear();
  renameAsset.mockClear();
  useDocumentStore.setState({
    assetId: null,
    asset: null,
    layers: [],
    step: null,
    undo,
    redo,
    write,
  });
  useProjectStore.setState({ assets: [], renameAsset });
  useShellStore.setState({ screen: 'editor', newSpriteOpen: false, platform: null });
  useEditorStore.setState({
    showPixelGrid: true,
    showLayersPanel: true,
    bottomPanel: 'steps',
    tileGuide: 0,
    targetRole: null,
  });
  useAnimationStore.setState({ animation: null });
});

describe('StudioHeader', () => {
  it('disables what acts on a sprite while none is open', () => {
    render(<StudioHeader />);

    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Y)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear active layer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Export File/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reference/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /New/ })).toBeEnabled();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it('renames on Enter and on blur, and puts the name back on Escape', () => {
    openSprite();
    render(<StudioHeader />);
    const input = screen.getByRole('textbox', { name: 'Sprite name' });
    expect(input).toHaveValue('Knight');
    expect(screen.getByText('24 x 24')).toBeInTheDocument();

    input.focus();
    fireEvent.change(input, { target: { value: 'Paladin' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameAsset).toHaveBeenCalledTimes(1);
    expect(renameAsset).toHaveBeenCalledWith('asset-1', 'Paladin');

    renameAsset.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: 'Squire' } });
    fireEvent.blur(input);
    expect(renameAsset).toHaveBeenCalledWith('asset-1', 'Squire');

    renameAsset.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: 'Mistake' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(renameAsset).not.toHaveBeenCalled();
    expect(input).toHaveValue('Knight');
  });

  it('undoes and redoes from the buttons and the shortcuts', () => {
    openSprite();
    render(<StudioHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo (Ctrl+Y)' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(3);
  });

  it('leaves Ctrl+Z to a text field that has focus', () => {
    openSprite();
    render(<StudioHeader />);
    const input = screen.getByRole('textbox', { name: 'Sprite name' });

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it('clears the layer the next stroke would write to', () => {
    openSprite();
    render(<StudioHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear active layer' }));
    expect(write).toHaveBeenCalledWith([{ kind: 'clear', layer: 'flats' }]);
  });

  it('refuses to clear a locked layer', () => {
    openSprite();
    useDocumentStore.setState({ layers: [{ ...FLATS, locked: true }] });
    render(<StudioHeader />);

    expect(screen.getByRole('button', { name: 'Clear active layer' })).toBeDisabled();
  });

  it('flips the view toggles in the editor store', () => {
    render(<StudioHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Pixel grid' }));
    expect(useEditorStore.getState().showPixelGrid).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Layer$/ }));
    expect(useEditorStore.getState().showLayersPanel).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Steps/ }));
    expect(useEditorStore.getState().bottomPanel).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Tile guide' }), {
      target: { value: '16' },
    });
    expect(useEditorStore.getState().tileGuide).toBe(16);
  });

  it('switches the bottom panel between the timeline and the steps, and hides the active one', () => {
    render(<StudioHeader />);
    const timeline = screen.getByRole('button', { name: /Timeline/ });
    const steps = screen.getByRole('button', { name: /Steps/ });
    expect(steps).toHaveAttribute('aria-pressed', 'true');
    expect(timeline).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(timeline);
    expect(useEditorStore.getState().bottomPanel).toBe('timeline');
    expect(timeline).toHaveAttribute('aria-pressed', 'true');
    expect(steps).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(timeline);
    expect(useEditorStore.getState().bottomPanel).toBeNull();

    fireEvent.click(steps);
    expect(useEditorStore.getState().bottomPanel).toBe('steps');
    fireEvent.click(timeline);
    expect(useEditorStore.getState().bottomPanel).toBe('timeline');
  });

  it('counts the frames, one for a lone sprite', () => {
    render(<StudioHeader />);
    expect(screen.getByRole('button', { name: /Timeline \(1\)/ })).toBeInTheDocument();

    const frame = { durationMs: 125, name: 'Knight', step: 'flats' as const, updatedAt: 0 };
    act(() => {
      useAnimationStore.setState({
        animation: {
          rootId: 'asset-1',
          playback: 'forward',
          frames: [0, 1, 2].map((position) => ({
            ...frame,
            assetId: `asset-${String(position + 1)}`,
            position,
          })),
        },
      });
    });
    expect(screen.getByRole('button', { name: /Timeline \(3\)/ })).toBeInTheDocument();
  });

  it('counts the step the sprite is on out of eleven', () => {
    render(<StudioHeader />);
    expect(screen.getByRole('button', { name: /Steps \(0\/11\)/ })).toBeInTheDocument();

    act(() => {
      openSprite();
    });
    expect(screen.getByRole('button', { name: /Steps \(4\/11\)/ })).toBeInTheDocument();
  });

  it('navigates home, to settings, and opens the new sprite dialog', () => {
    render(<StudioHeader />);

    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    expect(useShellStore.getState().newSpriteOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(useShellStore.getState().screen).toBe('settings');

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(useShellStore.getState().screen).toBe('home');
  });

  it('opens the agent popover and closes it on Escape and outside presses', () => {
    render(<StudioHeader />);
    const agent = screen.getByRole('button', { name: /Agent/ });

    fireEvent.click(agent);
    expect(agent).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Agent' })).toBeVisible();
    expect(screen.getByText('No agent connected')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(agent).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(agent);
    expect(agent).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(agent).toHaveAttribute('aria-expanded', 'false');
  });

  it('sends the agent popover to Settings for client configuration', () => {
    render(<StudioHeader />);

    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure clients in Settings' }));
    expect(useShellStore.getState().screen).toBe('settings');
  });

  it('draws window controls unless the system draws its own', () => {
    const { unmount } = render(<StudioHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(tauri.windowMinimize).toHaveBeenCalled();
    unmount();

    useShellStore.setState({ platform: { os: 'macos', systemWindowControls: true } });
    render(<StudioHeader />);
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument();
  });
});
