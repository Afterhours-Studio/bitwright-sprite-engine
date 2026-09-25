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

/** The new sprite dialog: what it defaults to, what it refuses, what it creates. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewSpriteDialog } from '@/features/home/NewSpriteDialog';
import type * as DocumentModule from '@/lib/document';
import i18n from '@/lib/i18n';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import type { Asset, Project } from '@/types/document';

vi.mock('@/lib/document', async (original) => ({
  ...(await original<typeof DocumentModule>()),
  assetCreate: vi.fn(),
  assetList: vi.fn(),
}));

const documents = await import('@/lib/document');

/**
 * A project row.
 *
 * @param id - Its identifier.
 * @param name - Its name.
 * @returns The row.
 */
function project(id: string, name: string): Project {
  return { id, name, styleId: null, createdAt: 1, updatedAt: 1 };
}

const CREATED: Asset = {
  id: 'new-1',
  projectId: 'p2',
  styleId: null,
  name: 'slime',
  kind: 'prop',
  width: 24,
  height: 24,
  step: 'reference',
  createdAt: 5,
  updatedAt: 5,
  rootId: null,
  frames: 1,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.mocked(documents.assetCreate).mockReset();
  vi.mocked(documents.assetCreate).mockResolvedValue({ ok: true, value: CREATED });
  vi.mocked(documents.assetList).mockResolvedValue({ ok: true, value: [CREATED] });
  useProjectStore.setState({
    projects: [project('p1', 'forest'), project('p2', 'cave')],
    assets: [],
    allAssets: [],
    presets: { p1: 'hd2d', p2: 'snes' },
    projectId: 'p2',
    assetId: null,
    loading: false,
    error: null,
  });
  useShellStore.setState({ screen: 'home', newSpriteOpen: true });
  useDocumentStore.setState({
    open: vi.fn<(assetId: string) => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn(),
  });
});

/** The submit button, whatever size it currently names. */
function submit(): HTMLElement {
  return screen.getByRole('button', { name: /^Create sprite/ });
}

describe('NewSpriteDialog', () => {
  it('renders nothing while closed', () => {
    useShellStore.setState({ newSpriteOpen: false });
    render(<NewSpriteDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults to the selected project and its preset size, and needs a name', () => {
    render(<NewSpriteDialog />);
    expect(screen.getByLabelText('Project')).toHaveValue('p2');
    expect(submit()).toHaveTextContent('Create sprite (48x64 px)');
    expect(submit()).toBeDisabled();
    expect(screen.getByRole('button', { name: /^48x64/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^48x64/ })).toHaveTextContent('Preset');

    fireEvent.change(screen.getByLabelText('Sprite name'), { target: { value: '   ' } });
    expect(submit()).toBeDisabled();
  });

  it('refuses a custom side outside 16 to 512', () => {
    render(<NewSpriteDialog />);
    fireEvent.change(screen.getByLabelText('Sprite name'), { target: { value: 'slime' } });
    fireEvent.click(screen.getByRole('button', { name: /^Custom/ }));

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '600' } });
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '8' } });
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '40' } });
    expect(submit()).toBeEnabled();
    expect(submit()).toHaveTextContent('Create sprite (100x40 px)');
  });

  it('creates the sprite in the chosen project and opens it in the editor', async () => {
    render(<NewSpriteDialog />);
    fireEvent.change(screen.getByLabelText('Sprite name'), { target: { value: ' slime ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prop' }));
    fireEvent.click(screen.getByRole('button', { name: /^24x24/ }));
    fireEvent.click(submit());

    await waitFor(() => {
      expect(useShellStore.getState().screen).toBe('editor');
    });
    expect(documents.assetCreate).toHaveBeenCalledWith('p2', 'slime', 'prop', 24, 24);
    expect(useShellStore.getState().newSpriteOpen).toBe(false);
    expect(useProjectStore.getState().assetId).toBe('new-1');
    expect(useProjectStore.getState().allAssets).toEqual([CREATED]);
  });

  it('stays open when the create is refused', async () => {
    vi.mocked(documents.assetCreate).mockResolvedValue({
      ok: false,
      error: { code: 'document.invalid_size', detail: '' },
    });
    render(<NewSpriteDialog />);
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Sprite name'), { target: { value: 'slime' } });
    fireEvent.click(submit());

    await waitFor(() => {
      expect(documents.assetCreate).toHaveBeenCalledWith('p1', 'slime', 'character', 48, 64);
    });
    expect(useShellStore.getState().newSpriteOpen).toBe(true);
    expect(useShellStore.getState().screen).toBe('home');
  });

  it('closes on Escape', () => {
    render(<NewSpriteDialog />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useShellStore.getState().newSpriteOpen).toBe(false);
  });
});
