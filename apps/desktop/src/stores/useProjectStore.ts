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
 * The tree: every project, the assets of the one that is open, and which of
 * each is selected.
 *
 * WHAT IS SELECTED LIVES HERE, NOT IN THE SIDEBAR
 *
 * The open asset decides what the canvas draws, what the tool panel writes to,
 * and what an agent's change events are matched against. A sidebar that held it
 * as component state would lose it the moment the sidebar unmounted, and would
 * be the only thing able to answer a question three other features ask.
 *
 * WHAT A LIST IS FOR
 *
 * The lists here are a view of the database and are replaced by what a command
 * returned rather than patched in place. A created asset is appended from the
 * row the shell sent back, not from the arguments it was created with, because
 * only the shell knows its identifier, its step and the size it settled on.
 *
 * WHY A FAILURE RAISES A TOAST AS WELL AS AN ERROR
 *
 * Creating, renaming and deleting are actions taken from a menu or a small
 * form, and the form closes. An error left only in this store would have
 * nowhere to be read once it had. Errors never dismiss themselves, so the
 * notification is the one channel that is still there afterwards; the reason
 * code stays in `error` as well, so the sidebar can also say so in place.
 */

import { create } from 'zustand';

import {
  assetCreate,
  assetDelete,
  assetList,
  assetRename,
  projectCreate,
  projectDelete,
  projectList,
  projectRename,
} from '@/lib/document';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useToastStore } from '@/stores/useToastStore';
import type { Asset, AssetKind, Project, StylePreset } from '@/types/document';

/** The message shown when one of the tree's actions fails. */
type FailureKey =
  | 'projects:toast.loadFailed'
  | 'projects:toast.createProjectFailed'
  | 'projects:toast.renameProjectFailed'
  | 'projects:toast.deleteProjectFailed'
  | 'projects:toast.createAssetFailed'
  | 'projects:toast.renameAssetFailed'
  | 'projects:toast.deleteAssetFailed';

interface ProjectState {
  /** Every project, oldest first. */
  projects: Project[];
  /** The selected project's assets, oldest first. Empty when none is selected. */
  assets: Asset[];
  /** Which project is open, or null. */
  projectId: string | null;
  /** Which asset is open, or null. */
  assetId: string | null;
  /** True while a command is in flight. */
  loading: boolean;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Reads every project, and the assets of whichever is selected. */
  load: () => Promise<void>;
  /** Opens a project and reads its assets. Passing null closes the one that is open. */
  selectProject: (id: string | null) => Promise<void>;
  /** Opens an asset, which is what puts a document on the canvas. */
  selectAsset: (id: string | null) => Promise<void>;
  /** Creates a project against a style preset, and selects it. */
  createProject: (name: string, preset: StylePreset) => Promise<void>;
  /** Renames a project. */
  renameProject: (id: string, name: string) => Promise<void>;
  /** Deletes a project, and everything under it. */
  deleteProject: (id: string) => Promise<void>;
  /** Creates an asset in the open project, and selects it. */
  createAsset: (name: string, kind: AssetKind, width: number, height: number) => Promise<void>;
  /** Renames an asset. */
  renameAsset: (id: string, name: string) => Promise<void>;
  /** Deletes an asset, its layers, its palette and its op log. */
  deleteAsset: (id: string) => Promise<void>;
  /** Clears the last error. */
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  /**
   * Records a failure, and says so where it can still be read.
   *
   * @param code - The stable reason code the command returned.
   * @param messageKey - Which action failed, as a translation key.
   */
  const fail = (code: string, messageKey: FailureKey): void => {
    set({ error: code, loading: false });
    useToastStore.getState().notify({
      severity: 'error',
      titleKey: 'projects:toast.failedTitle',
      messageKey,
    });
  };

  /**
   * Reads one project's assets, replacing whatever was listed.
   *
   * @param projectId - The project to list.
   * @returns True when the list was read.
   */
  const listAssets = async (projectId: string): Promise<boolean> => {
    const assets = await assetList(projectId);
    if (!assets.ok) {
      fail(assets.error.code, 'projects:toast.loadFailed');
      return false;
    }
    set({ assets: assets.value });
    return true;
  };

  return {
    projects: [],
    assets: [],
    projectId: null,
    assetId: null,
    loading: false,
    error: null,

    load: async () => {
      set({ loading: true, error: null });
      const projects = await projectList();
      if (!projects.ok) {
        set({ error: projects.error.code, loading: false });
        // No notification. A tree that has not been read yet is the state the
        // window starts in, and a toast on every launch outside a shell - which
        // is every test run - is noise rather than news.
        return;
      }

      // A project that has been deleted from under this window must not stay
      // selected, because everything downstream would then be asking about a
      // row that is gone.
      const selected = projects.value.some((project) => project.id === get().projectId)
        ? get().projectId
        : null;

      set({ projects: projects.value, loading: false });
      await get().selectProject(selected);
    },

    selectProject: async (id) => {
      if (id === null) {
        set({ projectId: null, assets: [] });
        await get().selectAsset(null);
        return;
      }

      set({ projectId: id, error: null });
      if (!(await listAssets(id))) {
        return;
      }
      // The asset that was open belongs to the project that was open. Keeping
      // it selected across a project change would leave the canvas showing a
      // sprite the tree no longer lists.
      const kept = get().assets.some((asset) => asset.id === get().assetId);
      await get().selectAsset(kept ? get().assetId : null);
    },

    selectAsset: async (id) => {
      set({ assetId: id });
      if (id === null) {
        useDocumentStore.getState().close();
        return;
      }
      // Opening the document is the point of selecting an asset, and doing it
      // here rather than in the sidebar is what stops a selected asset from
      // ever coexisting with a canvas showing something else.
      await useDocumentStore.getState().open(id);
    },

    createProject: async (name, preset) => {
      set({ loading: true, error: null });
      const created = await projectCreate(name, preset);
      if (!created.ok) {
        fail(created.error.code, 'projects:toast.createProjectFailed');
        return;
      }
      set({ projects: [...get().projects, created.value], loading: false });
      await get().selectProject(created.value.id);
    },

    renameProject: async (id, name) => {
      set({ loading: true, error: null });
      const renamed = await projectRename(id, name);
      if (!renamed.ok) {
        fail(renamed.error.code, 'projects:toast.renameProjectFailed');
        return;
      }
      const project = renamed.value;
      set({
        projects: get().projects.map((current) => (current.id === id ? project : current)),
        loading: false,
      });
    },

    deleteProject: async (id) => {
      set({ loading: true, error: null });
      const deleted = await projectDelete(id);
      if (!deleted.ok) {
        fail(deleted.error.code, 'projects:toast.deleteProjectFailed');
        return;
      }
      set({ projects: get().projects.filter((project) => project.id !== id), loading: false });
      if (get().projectId === id) {
        await get().selectProject(null);
      }
    },

    createAsset: async (name, kind, width, height) => {
      const projectId = get().projectId;
      if (projectId === null) {
        return;
      }

      set({ loading: true, error: null });
      const created = await assetCreate(projectId, name, kind, width, height);
      if (!created.ok) {
        fail(created.error.code, 'projects:toast.createAssetFailed');
        return;
      }
      set({ assets: [...get().assets, created.value], loading: false });
      await get().selectAsset(created.value.id);
    },

    renameAsset: async (id, name) => {
      set({ loading: true, error: null });
      const renamed = await assetRename(id, name);
      if (!renamed.ok) {
        fail(renamed.error.code, 'projects:toast.renameAssetFailed');
        return;
      }
      const asset = renamed.value;
      set({
        assets: get().assets.map((current) => (current.id === id ? asset : current)),
        loading: false,
      });
    },

    deleteAsset: async (id) => {
      set({ loading: true, error: null });
      const deleted = await assetDelete(id);
      if (!deleted.ok) {
        fail(deleted.error.code, 'projects:toast.deleteAssetFailed');
        return;
      }
      set({ assets: get().assets.filter((asset) => asset.id !== id), loading: false });
      if (get().assetId === id) {
        await get().selectAsset(null);
      }
    },

    clearError: () => {
      set({ error: null });
    },
  };
});
