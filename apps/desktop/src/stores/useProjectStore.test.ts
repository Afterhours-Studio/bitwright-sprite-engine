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
 * The tree: what selecting changes, and what a refused command leaves behind.
 *
 * The commands are stubbed rather than a shell being stood up, because what is
 * under test is the store's own arithmetic: which project is open, which assets
 * belong to it, and whether a failure is allowed to move any of that. The
 * bridge itself is exercised where it is used, against a real window.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/stores/useDocumentStore';
import { isListed, listedAssets, useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import type { Asset, Project, Style } from '@/types/document';

vi.mock('@/lib/document', () => ({
  projectList: vi.fn(),
  projectCreate: vi.fn(),
  projectRename: vi.fn(),
  projectDelete: vi.fn(),
  assetList: vi.fn(),
  assetCreate: vi.fn(),
  assetRename: vi.fn(),
  assetDelete: vi.fn(),
  styleRead: vi.fn(),
}));

const documents = await import('@/lib/document');

/**
 * A project row, as the shell would return one.
 *
 * @param id - Its identifier.
 * @param name - Its name.
 * @returns The row.
 */
function project(id: string, name: string): Project {
  return { id, name, styleId: `${id}-style`, createdAt: 1, updatedAt: 1 };
}

/**
 * An asset row, as the shell would return one.
 *
 * @param id - Its identifier.
 * @param projectId - The project it belongs to.
 * @param name - Its name.
 * @returns The row.
 */
function asset(id: string, projectId: string, name: string): Asset {
  return {
    id,
    projectId,
    styleId: null,
    name,
    kind: 'character',
    width: 48,
    height: 64,
    step: 'silhouette',
    createdAt: 1,
    updatedAt: 1,
    rootId: null,
    frames: 1,
  };
}

const HERO = asset('asset-1', 'project-1', 'hero');

beforeEach(() => {
  vi.mocked(documents.projectList).mockResolvedValue({
    ok: true,
    value: [project('project-1', 'forest')],
  });
  vi.mocked(documents.assetList).mockResolvedValue({ ok: true, value: [HERO] });
  useProjectStore.setState({
    projects: [],
    assets: [],
    projectId: null,
    assetId: null,
    loading: false,
    error: null,
    allAssets: [],
    presets: {},
    loadedAll: false,
  });
  vi.mocked(documents.styleRead).mockResolvedValue({
    ok: true,
    value: { preset: 'snes' } as Style,
  });
  useToastStore.setState({ visible: [], queued: [], unread: 0 });
  // Opening a document is a side effect of selecting an asset, and it belongs
  // to the document store rather than to this one. Replaced through the store's
  // own setter rather than spied on, so each test starts with a fresh count.
  useDocumentStore.setState({
    open: vi.fn<(assetId: string) => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn(),
  });
});

describe('useProjectStore', () => {
  it('reads the projects and the assets of the one that is selected', async () => {
    await useProjectStore.getState().load();
    await useProjectStore.getState().selectProject('project-1');

    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().projectId).toBe('project-1');
    expect(useProjectStore.getState().assets).toEqual([HERO]);
  });

  it('opens the document belonging to the asset that was selected', async () => {
    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().selectAsset('asset-1');

    expect(useProjectStore.getState().assetId).toBe('asset-1');
    expect(useDocumentStore.getState().open).toHaveBeenCalledWith('asset-1');
  });

  it('selects a created asset, using the row the shell returned rather than the arguments', async () => {
    const created = asset('asset-2', 'project-1', 'villager');
    vi.mocked(documents.assetCreate).mockResolvedValue({ ok: true, value: created });

    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().createAsset('villager', 'character', 48, 64);

    expect(documents.assetCreate).toHaveBeenCalledWith(
      'project-1',
      'villager',
      'character',
      48,
      64,
    );
    expect(useProjectStore.getState().assets).toEqual([HERO, created]);
    expect(useProjectStore.getState().assetId).toBe('asset-2');
  });

  it('leaves the tree alone and reports the reason when a create is refused', async () => {
    vi.mocked(documents.projectCreate).mockResolvedValue({
      ok: false,
      error: { code: 'store.constraint', detail: 'name already taken' },
    });

    await useProjectStore.getState().load();
    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().createProject('forest', 'hd2d');

    const state = useProjectStore.getState();
    expect(state.error).toBe('store.constraint');
    expect(state.loading).toBe(false);
    // One project, and it is the one that was already there. A store that
    // appended the row it hoped for would show a project that does not exist.
    expect(state.projects).toHaveLength(1);
    expect(state.projectId).toBe('project-1');
    expect(useToastStore.getState().visible).toHaveLength(1);
  });

  it('keeps the asset listed and selected when a delete is refused', async () => {
    vi.mocked(documents.assetDelete).mockResolvedValue({
      ok: false,
      error: { code: 'store.database_failed', detail: 'locked' },
    });

    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().selectAsset('asset-1');
    await useProjectStore.getState().deleteAsset('asset-1');

    expect(useProjectStore.getState().error).toBe('store.database_failed');
    expect(useProjectStore.getState().assets).toEqual([HERO]);
    expect(useProjectStore.getState().assetId).toBe('asset-1');
  });

  it('drops the selection when the asset behind it is deleted', async () => {
    vi.mocked(documents.assetDelete).mockResolvedValue({ ok: true, value: null });

    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().selectAsset('asset-1');
    await useProjectStore.getState().deleteAsset('asset-1');

    expect(useProjectStore.getState().assets).toEqual([]);
    expect(useProjectStore.getState().assetId).toBeNull();
    expect(useDocumentStore.getState().close).toHaveBeenCalled();
  });

  it('forgets a selected project that is no longer in the database', async () => {
    useProjectStore.setState({ projectId: 'project-gone', assetId: 'asset-gone' });

    await useProjectStore.getState().load();

    expect(useProjectStore.getState().projectId).toBeNull();
    expect(useProjectStore.getState().assetId).toBeNull();
  });

  it('renameProject replaces the row with what the shell returned', async () => {
    const renamed = project('project-1', 'renamed forest');
    vi.mocked(documents.projectRename).mockResolvedValue({ ok: true, value: renamed });

    await useProjectStore.getState().load();
    await useProjectStore.getState().renameProject('project-1', 'renamed forest');

    expect(documents.projectRename).toHaveBeenCalledWith('project-1', 'renamed forest');
    expect(useProjectStore.getState().projects).toEqual([renamed]);
    expect(useProjectStore.getState().loading).toBe(false);
  });

  it('renameProject reports the reason when the shell refuses', async () => {
    vi.mocked(documents.projectRename).mockResolvedValue({
      ok: false,
      error: { code: 'store.constraint', detail: 'taken' },
    });

    await useProjectStore.getState().load();
    await useProjectStore.getState().renameProject('project-1', 'taken');

    expect(useProjectStore.getState().error).toBe('store.constraint');
    expect(useToastStore.getState().visible).toHaveLength(1);
  });

  it('deleteProject removes the row and deselects it when it was open', async () => {
    vi.mocked(documents.projectDelete).mockResolvedValue({ ok: true, value: null });

    await useProjectStore.getState().load();
    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().deleteProject('project-1');

    const state = useProjectStore.getState();
    expect(state.projects).toEqual([]);
    expect(state.projectId).toBeNull();
    expect(state.assets).toEqual([]);
  });

  it('deleteProject leaves an unrelated selection alone', async () => {
    vi.mocked(documents.projectList).mockResolvedValue({
      ok: true,
      value: [project('project-1', 'forest'), project('project-2', 'desert')],
    });
    vi.mocked(documents.projectDelete).mockResolvedValue({ ok: true, value: null });

    await useProjectStore.getState().load();
    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().deleteProject('project-2');

    const state = useProjectStore.getState();
    expect(state.projects.map((p) => p.id)).toEqual(['project-1']);
    expect(state.projectId).toBe('project-1');
  });

  it('renameAsset replaces the row with what the shell returned', async () => {
    const renamed = asset('asset-1', 'project-1', 'renamed hero');
    vi.mocked(documents.assetRename).mockResolvedValue({ ok: true, value: renamed });

    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().renameAsset('asset-1', 'renamed hero');

    expect(documents.assetRename).toHaveBeenCalledWith('asset-1', 'renamed hero');
    expect(useProjectStore.getState().assets).toEqual([renamed]);
  });

  it('renameAsset reports the reason when the shell refuses', async () => {
    vi.mocked(documents.assetRename).mockResolvedValue({
      ok: false,
      error: { code: 'store.constraint', detail: 'taken' },
    });

    await useProjectStore.getState().selectProject('project-1');
    await useProjectStore.getState().renameAsset('asset-1', 'taken');

    expect(useProjectStore.getState().error).toBe('store.constraint');
    expect(useProjectStore.getState().assets).toEqual([HERO]);
  });

  it('clearError clears the last error', async () => {
    vi.mocked(documents.projectCreate).mockResolvedValue({
      ok: false,
      error: { code: 'store.constraint', detail: 'name already taken' },
    });

    await useProjectStore.getState().createProject('forest', 'hd2d');
    expect(useProjectStore.getState().error).toBe('store.constraint');

    useProjectStore.getState().clearError();

    expect(useProjectStore.getState().error).toBeNull();
  });

  describe('across projects', () => {
    const CAVE = project('project-2', 'cave');
    const BAT = asset('asset-3', 'project-2', 'bat');

    beforeEach(() => {
      vi.mocked(documents.projectList).mockResolvedValue({
        ok: true,
        value: [project('project-1', 'forest'), CAVE],
      });
      vi.mocked(documents.assetList).mockImplementation((id) =>
        Promise.resolve({ ok: true, value: id === 'project-1' ? [HERO] : [BAT] }),
      );
    });

    it('loadAll reads every project, its assets and its preset', async () => {
      await useProjectStore.getState().loadAll();

      const state = useProjectStore.getState();
      expect(state.allAssets).toEqual([HERO, BAT]);
      expect(state.presets).toEqual({ 'project-1': 'snes', 'project-2': 'snes' });
      expect(state.loadedAll).toBe(true);
      expect(state.error).toBeNull();
    });

    it('loadAll reports a refused asset list without a toast', async () => {
      vi.mocked(documents.assetList).mockResolvedValue({
        ok: false,
        error: { code: 'store.io', detail: '' },
      });
      await useProjectStore.getState().loadAll();

      expect(useProjectStore.getState().error).toBe('store.io');
      expect(useProjectStore.getState().loadedAll).toBe(true);
      expect(useToastStore.getState().visible).toHaveLength(0);
    });

    it('openAsset selects the asset and the project it belongs to', async () => {
      await useProjectStore.getState().loadAll();
      await useProjectStore.getState().openAsset(BAT);

      expect(useProjectStore.getState().projectId).toBe('project-2');
      expect(useProjectStore.getState().assetId).toBe('asset-3');
      expect(useDocumentStore.getState().open).toHaveBeenLastCalledWith('asset-3');
    });

    it('createAssetIn creates into the named project and returns the row', async () => {
      const slime = asset('asset-4', 'project-2', 'slime');
      vi.mocked(documents.assetCreate).mockResolvedValue({ ok: true, value: slime });
      await useProjectStore.getState().loadAll();
      await useProjectStore.getState().selectProject('project-1');

      const created = await useProjectStore
        .getState()
        .createAssetIn('project-2', 'slime', 'character', 32, 32);

      expect(created).toEqual(slime);
      expect(documents.assetCreate).toHaveBeenLastCalledWith(
        'project-2',
        'slime',
        'character',
        32,
        32,
      );
      expect(useProjectStore.getState().projectId).toBe('project-2');
      expect(useProjectStore.getState().assetId).toBe('asset-4');
      expect(useProjectStore.getState().allAssets).toContainEqual(slime);
    });

    it('keeps allAssets fresh after a rename and a delete', async () => {
      vi.mocked(documents.assetRename).mockResolvedValue({
        ok: true,
        value: { ...BAT, name: 'vampire' },
      });
      vi.mocked(documents.assetDelete).mockResolvedValue({ ok: true, value: null });
      vi.mocked(documents.projectDelete).mockResolvedValue({ ok: true, value: null });
      await useProjectStore.getState().loadAll();

      await useProjectStore.getState().renameAsset('asset-3', 'vampire');
      expect(useProjectStore.getState().allAssets.map((entry) => entry.name)).toEqual([
        'hero',
        'vampire',
      ]);

      await useProjectStore.getState().deleteAsset('asset-1');
      expect(useProjectStore.getState().allAssets.map((entry) => entry.id)).toEqual(['asset-3']);

      await useProjectStore.getState().deleteProject('project-2');
      expect(useProjectStore.getState().allAssets).toEqual([]);
    });
  });

  describe('animations', () => {
    const ROOT = { ...asset('root', 'project-1', 'walk'), frames: 3 };
    const F1 = { ...asset('f1', 'project-1', 'walk 2'), rootId: 'root', frames: 0 };
    const F2 = { ...asset('f2', 'project-1', 'walk 3'), rootId: 'root', frames: 0 };

    it('lists roots and lone sprites, not later frames', () => {
      expect(listedAssets([HERO, ROOT, F1, F2]).map((row) => row.id)).toEqual(['asset-1', 'root']);
      expect(isListed(F1)).toBe(false);
      expect(isListed(ROOT)).toBe(true);
    });

    it('drops every frame of a deleted root, and closes a frame that was open', async () => {
      vi.mocked(documents.assetList).mockResolvedValue({ ok: true, value: [HERO, ROOT, F1, F2] });
      vi.mocked(documents.assetDelete).mockResolvedValue({ ok: true, value: null });
      await useProjectStore.getState().selectProject('project-1');
      useProjectStore.setState({ allAssets: [HERO, ROOT, F1, F2] });
      await useProjectStore.getState().selectAsset('f2');

      await useProjectStore.getState().deleteAsset('root');

      expect(useProjectStore.getState().assets).toEqual([HERO]);
      expect(useProjectStore.getState().allAssets).toEqual([HERO]);
      expect(useProjectStore.getState().assetId).toBeNull();
    });
  });
});
