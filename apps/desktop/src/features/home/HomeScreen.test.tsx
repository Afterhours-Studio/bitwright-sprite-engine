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
 * Home, against a stubbed document bridge: what it lists, how it orders and
 * narrows the list, what opening does, and that deleting asks first.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeScreen } from '@/features/home/HomeScreen';
import { clearThumbnailCache } from '@/features/home/thumbnailCache';
import type * as DocumentModule from '@/lib/document';
import i18n from '@/lib/i18n';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import type { Asset, Project, Style } from '@/types/document';

vi.mock('@/lib/document', async (original) => ({
  ...(await original<typeof DocumentModule>()),
  projectList: vi.fn(),
  projectRename: vi.fn(),
  projectDelete: vi.fn(),
  assetList: vi.fn(),
  assetDelete: vi.fn(),
  assetRename: vi.fn(),
  styleRead: vi.fn(),
  documentComposite: vi.fn(),
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
  return { id, name, styleId: `${id}-style`, createdAt: 1, updatedAt: 1 };
}

/**
 * An asset row.
 *
 * @param overrides - The fields that differ.
 * @returns The row.
 */
function asset(overrides: Partial<Asset> & Pick<Asset, 'id' | 'projectId' | 'name'>): Asset {
  return {
    styleId: null,
    kind: 'character',
    width: 32,
    height: 32,
    step: 'flats',
    createdAt: 1,
    updatedAt: 1,
    rootId: null,
    frames: 1,
    ...overrides,
  };
}

const FOREST = project('p1', 'forest');
const CAVE = project('p2', 'cave');
const HERO = asset({
  id: 'a1',
  projectId: 'p1',
  name: 'hero',
  updatedAt: 100,
  width: 16,
  height: 16,
});
const TREE = asset({ id: 'a2', projectId: 'p1', name: 'tree', updatedAt: 300, kind: 'prop' });
const BAT = asset({
  id: 'a3',
  projectId: 'p2',
  name: 'bat',
  updatedAt: 200,
  width: 64,
  height: 64,
});

/** The names of the open buttons, in the order they are on screen. */
function cardOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /^Open / })
    .map((button) => (button.getAttribute('aria-label') ?? '').replace(/^Open /, ''));
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  clearThumbnailCache();
  vi.mocked(documents.projectList).mockResolvedValue({ ok: true, value: [FOREST, CAVE] });
  vi.mocked(documents.assetList).mockImplementation((id) =>
    Promise.resolve({
      ok: true,
      value: [HERO, TREE, BAT].filter((entry) => entry.projectId === id),
    }),
  );
  vi.mocked(documents.styleRead).mockResolvedValue({
    ok: true,
    value: { preset: 'snes' } as Style,
  });
  vi.mocked(documents.documentComposite).mockResolvedValue({
    ok: false,
    error: { code: 'shell.unavailable', detail: '' },
  });
  vi.mocked(documents.assetDelete).mockResolvedValue({ ok: true, value: null });
  vi.mocked(documents.projectRename).mockResolvedValue({
    ok: true,
    value: { ...FOREST, name: 'woods' },
  });
  useProjectStore.setState({
    projects: [],
    assets: [],
    allAssets: [],
    presets: {},
    loadedAll: false,
    projectId: null,
    assetId: null,
    loading: false,
    error: null,
  });
  useShellStore.setState({ screen: 'home', newSpriteOpen: false, appVersion: '1.2.3' });
  useDocumentStore.setState({
    open: vi.fn<(assetId: string) => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn(),
  });
});

describe('HomeScreen', () => {
  it('lists every sprite of every project, most recent first', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open bat' });
    expect(cardOrder()).toEqual(['tree', 'bat', 'hero']);
    expect(screen.getByText('Afterhours Studio · v1.2.3')).toBeInTheDocument();
  });

  it('sorts by the chosen key and flips the direction', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open bat' });

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'size' } });
    expect(cardOrder()).toEqual(['bat', 'tree', 'hero']);

    fireEvent.click(screen.getByRole('button', { name: 'Descending' }));
    expect(cardOrder()).toEqual(['hero', 'tree', 'bat']);
  });

  it('narrows the list by name and says when nothing matches', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open bat' });

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'TR' } });
    expect(cardOrder()).toEqual(['tree']);

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'dragon' } });
    expect(screen.getByText('No sprite matches “dragon”.')).toBeInTheDocument();
  });

  it('opens a sprite: selects its project and asset, then shows the editor', async () => {
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open bat' }));

    await waitFor(() => {
      expect(useShellStore.getState().screen).toBe('editor');
    });
    expect(useProjectStore.getState().projectId).toBe('p2');
    expect(useProjectStore.getState().assetId).toBe('a3');
    expect(useDocumentStore.getState().open).toHaveBeenCalledWith('a3');
  });

  it('deletes a sprite only once the confirmation is accepted', async () => {
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete hero' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete hero' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(documents.assetDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete hero' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete hero' })).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open hero' })).not.toBeInTheDocument();
    });
    expect(documents.assetDelete).toHaveBeenCalledWith('a1');
  });

  it('shows the list view as a table of the same sprites', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open bat' });
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('cave')).toBeInTheDocument();
  });

  it('groups sprites by project and renames a project', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open bat' });
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

    const forest = screen.getByRole('region', { name: 'forest' });
    expect(within(forest).getByText('Preset: SNES')).toBeInTheDocument();
    expect(within(forest).getAllByRole('button', { name: /^Open / })).toHaveLength(2);

    fireEvent.click(within(forest).getByRole('button', { name: 'Rename forest' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename project' });
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'woods' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

    await screen.findByRole('region', { name: 'woods' });
    expect(documents.projectRename).toHaveBeenCalledWith('p1', 'woods');
  });

  it('says so in place when the library cannot be read', async () => {
    vi.mocked(documents.projectList).mockResolvedValue({
      ok: false,
      error: { code: 'shell.unavailable', detail: '' },
    });
    render(<HomeScreen />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('No sprites yet')).toBeInTheDocument();
  });

  it('goes to settings from the agent card', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open bat' });
    fireEvent.click(screen.getByRole('button', { name: 'Connect an agent' }));
    expect(useShellStore.getState().screen).toBe('settings');
  });

  it('renders the trailing slot in the head row', async () => {
    render(<HomeScreen trailing={<span>window controls</span>} />);
    await screen.findByRole('button', { name: 'Open bat' });
    expect(screen.getByText('window controls')).toBeInTheDocument();
  });
});

describe('HomeScreen with an animation', () => {
  const WALK = asset({ id: 'w0', projectId: 'p2', name: 'walk', updatedAt: 50, frames: 3 });
  const WALK_1 = asset({ id: 'w1', projectId: 'p2', name: 'walk 2', rootId: 'w0', frames: 0 });
  const WALK_2 = asset({ id: 'w2', projectId: 'p2', name: 'walk 3', rootId: 'w0', frames: 0 });

  beforeEach(() => {
    vi.mocked(documents.assetList).mockImplementation((id) =>
      Promise.resolve({
        ok: true,
        value: [HERO, TREE, BAT, WALK, WALK_1, WALK_2].filter((entry) => entry.projectId === id),
      }),
    );
  });

  it('lists the root only, and counts it once in its project', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open walk' });
    expect(cardOrder()).toEqual(['tree', 'bat', 'hero', 'walk']);

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    const cave = screen.getByRole('region', { name: 'cave' });
    expect(within(cave).getByText('2 sprites')).toBeInTheDocument();
    expect(within(cave).getAllByRole('button', { name: /^Open / })).toHaveLength(2);
  });

  it('badges the root with its frame count, and only the root', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open walk' });
    expect(screen.getAllByText(/^\d+ frames?$/)).toHaveLength(1);
    expect(screen.getByText('3 frames')).toBeInTheDocument();
  });

  it('sorts by frames and shows a Frames column in the list', async () => {
    render(<HomeScreen />);
    await screen.findByRole('button', { name: 'Open walk' });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'frames' } });
    expect(cardOrder()[0]).toBe('walk');

    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Frames' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(5);
  });

  it('warns that deleting the root takes every frame with it', async () => {
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete walk' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete walk' });
    expect(within(dialog).getByText(/all 3 of its frames/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open walk' })).not.toBeInTheDocument();
    });
    expect(documents.assetDelete).toHaveBeenCalledWith('w0');
    expect(useProjectStore.getState().allAssets.some((row) => row.rootId === 'w0')).toBe(false);
  });

  it('keeps the ordinary warning for a lone sprite', async () => {
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete hero' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete hero' });
    expect(within(dialog).queryByText(/of its frames/)).not.toBeInTheDocument();
  });
});
