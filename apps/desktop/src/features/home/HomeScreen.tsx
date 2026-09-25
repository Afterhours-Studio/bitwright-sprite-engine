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
 * Home: every sprite of every project, and everything that creates, renames,
 * deletes or opens one.
 *
 * WHY HOME LISTS ACROSS PROJECTS
 *
 * The sprite being worked on is found by when it was last touched far more
 * often than by which project it is in, so Recent is the whole library in one
 * grid. Projects is the same grid grouped under each project, and is where the
 * project-level commands live: what the old project sidebar did, spread out
 * where there is room for it.
 *
 * WHY DELETING ASKS
 *
 * Deleting a sprite takes its layers, its palette and its op log with it, and
 * the op log is what undo reads from, so there is nothing left to undo it with.
 * The confirmation says that rather than asking whether the user is sure.
 */

import {
  ArrowDown,
  ArrowUp,
  FolderPlus,
  ImagePlus,
  LayoutGrid,
  List,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ui/Dialog';
import { AssetCard, AssetRow } from '@/features/home/AssetCard';
import { HomeSidebar, type HomeView } from '@/features/home/HomeSidebar';
import { NewProjectDialog, RenameDialog } from '@/features/home/NameDialogs';
import {
  SORT_KEYS,
  filterAssets,
  sortAssets,
  type SortDirection,
  type SortKey,
} from '@/features/home/sortAssets';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import type { Asset, Project } from '@/types/document';

export interface HomeScreenProps {
  /**
   * Rendered at the trailing end of the main head row, which is the window's
   * drag region. The integrator passes the window controls here.
   */
  trailing?: ReactNode;
}

/** How the sprites are laid out. */
type Layout = 'grid' | 'list';

/** Which form is open, and what it acts on. */
type Pending =
  | { kind: 'none' }
  | { kind: 'newProject' }
  | { kind: 'renameProject'; project: Project }
  | { kind: 'deleteProject'; project: Project }
  | { kind: 'renameAsset'; asset: Asset }
  | { kind: 'deleteAsset'; asset: Asset };

const SORT_LABEL = {
  recent: 'toolbar.sortRecent',
  name: 'toolbar.sortName',
  size: 'toolbar.sortSize',
  kind: 'toolbar.sortKind',
} as const satisfies Record<SortKey, string>;

const GRID =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 pt-2';

/** The home screen. Fills the region it is mounted in. */
export function HomeScreen({ trailing }: HomeScreenProps): ReactElement {
  const { t } = useTranslation('home');
  const { t: tp } = useTranslation('projects');
  const { t: tc } = useTranslation('common');
  const translateError = useErrorMessage();
  const ids = useId();

  const projects = useProjectStore((state) => state.projects);
  const allAssets = useProjectStore((state) => state.allAssets);
  const presets = useProjectStore((state) => state.presets);
  const loading = useProjectStore((state) => state.loading);
  const loadedAll = useProjectStore((state) => state.loadedAll);
  const error = useProjectStore((state) => state.error);
  const loadAll = useProjectStore((state) => state.loadAll);
  const openAsset = useProjectStore((state) => state.openAsset);
  const selectProject = useProjectStore((state) => state.selectProject);
  const renameAsset = useProjectStore((state) => state.renameAsset);
  const deleteAsset = useProjectStore((state) => state.deleteAsset);
  const renameProject = useProjectStore((state) => state.renameProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const setScreen = useShellStore((state) => state.setScreen);
  const setNewSpriteOpen = useShellStore((state) => state.setNewSpriteOpen);

  const [view, setView] = useState<'recent' | 'projects'>('recent');
  const [layout, setLayout] = useState<Layout>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending>({ kind: 'none' });

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const visible = useMemo(
    () => sortAssets(filterAssets(allAssets, query), sortKey, direction),
    [allAssets, query, sortKey, direction],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const navigate = (next: HomeView): void => {
    if (next === 'settings') {
      setScreen('settings');
      return;
    }
    setView(next);
  };

  const open = (asset: Asset): void => {
    void openAsset(asset).then(() => {
      setScreen('editor');
    });
  };

  const close = (): void => {
    setPending({ kind: 'none' });
  };

  const handlers = {
    onOpen: open,
    onRename: (asset: Asset) => {
      setPending({ kind: 'renameAsset', asset });
    },
    onDelete: (asset: Asset) => {
      setPending({ kind: 'deleteAsset', asset });
    },
  };

  const renderAssets = (assets: Asset[]): ReactElement =>
    layout === 'grid' ? (
      <div className={GRID}>
        {assets.map((asset) => (
          <AssetCard key={asset.id} asset={asset} {...handlers} />
        ))}
      </div>
    ) : (
      <table className="mt-2 w-full text-left text-xs">
        <thead className="text-[11px] text-neutral-500">
          <tr className="border-b border-neutral-800/60">
            <th className="py-1.5 pr-3 font-medium">{t('columns.name')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('columns.project')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('columns.size')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('columns.kind')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('columns.step')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('columns.updated')}</th>
            <th className="py-1.5 text-right font-medium">
              <span className="sr-only">{t('columns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              projectName={projectNames.get(asset.projectId)}
              {...handlers}
            />
          ))}
        </tbody>
      </table>
    );

  const failure = loadedAll && error !== null ? (translateError(error) ?? t('state.error')) : null;

  const body = ((): ReactNode => {
    if (!loadedAll && loading) {
      return (
        <p role="status" className="py-10 text-center text-xs text-neutral-500">
          {t('state.loading')}
        </p>
      );
    }
    if (view === 'recent') {
      if (allAssets.length === 0) {
        return <Empty title={t('state.emptyRecent')} hint={t('state.emptyRecentHint')} />;
      }
      if (visible.length === 0) {
        return <Empty title={t('state.noMatch', { query: query.trim() })} />;
      }
      return renderAssets(visible);
    }
    if (projects.length === 0) {
      return <Empty title={t('state.emptyProjects')} hint={t('state.emptyProjectsHint')} />;
    }
    return (
      <div className="flex flex-col gap-8 pt-2">
        {projects.map((project) => {
          const preset = presets[project.id];
          const own = visible.filter((asset) => asset.projectId === project.id);
          const total = allAssets.filter((asset) => asset.projectId === project.id).length;
          return (
            <section key={project.id} aria-labelledby={`${ids}-${project.id}`}>
              <div className="group flex flex-wrap items-center gap-2 border-b border-neutral-800/60 pb-2">
                <h2
                  id={`${ids}-${project.id}`}
                  className="truncate text-sm font-semibold text-neutral-100"
                >
                  {project.name}
                </h2>
                {preset !== undefined && (
                  <span className="rounded bg-neutral-800/60 px-1.5 py-0.5 text-[10px] text-neutral-400 border border-neutral-700/50">
                    {t('project.preset', { preset: tp(`presets.${preset}`) })}
                  </span>
                )}
                <span className="text-[11px] text-neutral-500">
                  {t('project.count', { count: total })}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      void selectProject(project.id).then(() => {
                        setNewSpriteOpen(true);
                      });
                    }}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-pink-400"
                  >
                    <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('project.newSprite')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('project.rename', { name: project.name })}
                    title={t('project.rename', { name: project.name })}
                    onClick={() => {
                      setPending({ kind: 'renameProject', project });
                    }}
                    className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('project.delete', { name: project.name })}
                    title={t('project.delete', { name: project.name })}
                    onClick={() => {
                      setPending({ kind: 'deleteProject', project });
                    }}
                    className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {total === 0 ? (
                <p className="pt-3 text-xs text-neutral-500">{t('state.emptyProject')}</p>
              ) : own.length === 0 ? (
                <p className="pt-3 text-xs text-neutral-500">
                  {t('state.noMatch', { query: query.trim() })}
                </p>
              ) : (
                renderAssets(own)
              )}
            </section>
          );
        })}
      </div>
    );
  })();

  const deleting =
    pending.kind === 'deleteAsset'
      ? pending.asset
      : pending.kind === 'deleteProject'
        ? pending.project
        : null;
  const renaming =
    pending.kind === 'renameAsset'
      ? pending.asset
      : pending.kind === 'renameProject'
        ? pending.project
        : null;

  return (
    <div className="relative flex h-full w-full bg-studio-home text-neutral-100 select-none overflow-hidden">
      <HomeSidebar active={view} onNavigate={navigate} />

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-studio-home p-6 lg:p-8">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between pb-3 border-b border-neutral-800/60"
        >
          <h1 data-tauri-drag-region className="text-base font-semibold text-neutral-100">
            {t(view === 'recent' ? 'sidebar.recent' : 'sidebar.projects')}
          </h1>
          <div className="flex items-center gap-1">
            {view === 'projects' && (
              <button
                type="button"
                onClick={() => {
                  setPending({ kind: 'newProject' });
                }}
                className="mr-2 flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-pink-400"
              >
                <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                {t('sidebar.newProject')}
              </button>
            )}
            <LayoutToggle
              label={t('toolbar.grid')}
              on={layout === 'grid'}
              onPress={() => {
                setLayout('grid');
              }}
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
            </LayoutToggle>
            <LayoutToggle
              label={t('toolbar.list')}
              on={layout === 'list'}
              onPress={() => {
                setLayout('list');
              }}
            >
              <List className="w-4 h-4" aria-hidden="true" />
            </LayoutToggle>
            {trailing}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <label htmlFor={`${ids}-sort`}>{t('toolbar.sort')}</label>
            <select
              id={`${ids}-sort`}
              value={sortKey}
              onChange={(event) => {
                setSortKey(SORT_KEYS.find((key) => key === event.target.value) ?? 'recent');
              }}
              className="bg-transparent text-neutral-200 focus:outline-none"
            >
              {SORT_KEYS.map((key) => (
                <option key={key} value={key} className="bg-neutral-900">
                  {t(SORT_LABEL[key])}
                </option>
              ))}
            </select>
            <span className="h-4 border-l border-neutral-700" aria-hidden="true" />
            <button
              type="button"
              aria-label={direction === 'asc' ? t('toolbar.ascending') : t('toolbar.descending')}
              title={direction === 'asc' ? t('toolbar.ascending') : t('toolbar.descending')}
              onClick={() => {
                setDirection(direction === 'asc' ? 'desc' : 'asc');
              }}
              className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-50"
            >
              {direction === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor={`${ids}-filter`}>{t('toolbar.filter')}</label>
            <input
              id={`${ids}-filter`}
              type="search"
              value={query}
              placeholder={t('toolbar.filterPlaceholder')}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="bg-transparent border-b border-neutral-700 italic w-36 sm:w-48 text-neutral-200 placeholder:text-neutral-600 focus:border-pink-500 focus:outline-none"
            />
          </div>
        </div>

        {failure !== null && (
          <div
            role="alert"
            className="mb-3 flex items-center justify-between gap-3 rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-xs text-red-300"
          >
            <span>{failure}</span>
            <button
              type="button"
              onClick={() => {
                void loadAll();
              }}
              className="rounded px-2 py-1 font-medium text-red-200 hover:bg-red-900/40"
            >
              {tc('actions.retry')}
            </button>
          </div>
        )}

        {body}
      </main>

      <NewProjectDialog open={pending.kind === 'newProject'} onClose={close} />
      <RenameDialog
        open={renaming !== null}
        title={
          pending.kind === 'renameProject'
            ? tp('form.renameProjectTitle')
            : tp('form.renameAssetTitle')
        }
        label={pending.kind === 'renameProject' ? tp('form.projectName') : tp('form.assetName')}
        initial={renaming?.name ?? ''}
        onClose={close}
        onRename={(name) => {
          if (pending.kind === 'renameProject') {
            void renameProject(pending.project.id, name);
          } else if (pending.kind === 'renameAsset') {
            void renameAsset(pending.asset.id, name);
          }
          close();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={tp(
          pending.kind === 'deleteProject'
            ? 'confirm.deleteProjectTitle'
            : 'confirm.deleteAssetTitle',
          { name: deleting?.name ?? '' },
        )}
        body={tp(
          pending.kind === 'deleteProject'
            ? 'confirm.deleteProjectBody'
            : 'confirm.deleteAssetBody',
        )}
        confirmLabel={tp('confirm.delete')}
        onDismiss={close}
        onConfirm={() => {
          if (pending.kind === 'deleteProject') {
            void deleteProject(pending.project.id);
          } else if (pending.kind === 'deleteAsset') {
            void deleteAsset(pending.asset.id);
          }
          close();
        }}
      />
    </div>
  );
}

/** One of the grid/list toggles in the head row. */
function LayoutToggle({
  label,
  on,
  onPress,
  children,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        'p-1.5 rounded',
        on ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-500 hover:text-neutral-200',
      )}
    >
      {children}
    </button>
  );
}

/** What an empty grid says instead of showing nothing. */
function Empty({ title, hint }: { title: string; hint?: string }): ReactElement {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
