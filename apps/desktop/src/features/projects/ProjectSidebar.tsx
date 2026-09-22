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
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Menu } from '@/components/ui/Menu';
import { NumberField } from '@/components/ui/NumberField';
import { Select } from '@/components/ui/Select';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  ASSET_KINDS,
  DEFAULT_PRESET,
  PRESET_CANVAS,
  STYLE_PRESETS,
  type Asset,
  type AssetKind,
  type Project,
  type StylePreset,
} from '@/types/document';

/**
 * Smallest and largest canvas the form will offer.
 *
 * The ceiling is not the engine's - a buffer may be far larger - it is the
 * largest sprite this workflow is for. A canvas past it is a tilemap, and a
 * tilemap is a different asset kind with its own task.
 */
const MIN_SIZE = 1;
const MAX_SIZE = 1024;

/** Which form is open, and what it is acting on. */
type Prompt =
  | { kind: 'none' }
  | { kind: 'newProject' }
  | { kind: 'renameProject'; project: Project }
  | { kind: 'deleteProject'; project: Project }
  | { kind: 'newAsset' }
  | { kind: 'renameAsset'; asset: Asset }
  | { kind: 'deleteAsset'; asset: Asset };

/**
 * The left sidebar: every project, the assets of the one that is open, and the
 * commands that change either.
 *
 * WHY THE COMMANDS ARE IN ONE MENU RATHER THAN ON EVERY ROW
 *
 * A row carries one job, which is to be selected; the six commands act on
 * whatever is selected. Put on the rows they would be twelve controls in a
 * column narrow enough that each is a few pixels wide, and the delete would sit
 * a few pixels from the select on every line in the tree.
 *
 * WHY DELETING ASKS
 *
 * Deleting an asset takes its layers, its palette and its op log with it, and
 * the op log is what undo reads from - so there is nothing left to undo it
 * with. The confirmation says that rather than asking whether the user is sure,
 * because being sure is not the part they are missing.
 */
export function ProjectSidebar(): ReactElement {
  const { t } = useTranslation('projects');
  const translateError = useErrorMessage();

  const projects = useProjectStore((state) => state.projects);
  const assets = useProjectStore((state) => state.assets);
  const projectId = useProjectStore((state) => state.projectId);
  const assetId = useProjectStore((state) => state.assetId);
  const error = useProjectStore((state) => state.error);
  const load = useProjectStore((state) => state.load);
  const selectProject = useProjectStore((state) => state.selectProject);
  const selectAsset = useProjectStore((state) => state.selectAsset);

  const [prompt, setPrompt] = useState<Prompt>({ kind: 'none' });

  useEffect(() => {
    void load();
  }, [load]);

  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const asset = assets.find((candidate) => candidate.id === assetId) ?? null;
  const close = (): void => {
    setPrompt({ kind: 'none' });
  };

  const onCommand = (groupId: string, itemId: string): void => {
    if (itemId === 'new') {
      setPrompt({ kind: groupId === 'project' ? 'newProject' : 'newAsset' });
      return;
    }
    if (groupId === 'project' && project !== null) {
      setPrompt(
        itemId === 'rename'
          ? { kind: 'renameProject', project }
          : { kind: 'deleteProject', project },
      );
      return;
    }
    if (groupId === 'asset' && asset !== null) {
      setPrompt(
        itemId === 'rename' ? { kind: 'renameAsset', asset } : { kind: 'deleteAsset', asset },
      );
    }
  };

  const message = translateError(error);

  return (
    <aside
      aria-label={t('sidebar')}
      className="flex w-60 shrink-0 flex-col gap-2 border-e border-line-subtle bg-surface-well p-2"
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          {t('title')}
        </h2>
        <Menu
          label={t('menu.label')}
          align="end"
          groups={[
            {
              id: 'project',
              label: t('menu.project'),
              items: [
                { id: 'new', label: t('menu.newProject') },
                { id: 'rename', label: t('menu.renameProject'), disabled: project === null },
                { id: 'delete', label: t('menu.deleteProject'), disabled: project === null },
              ],
            },
            {
              id: 'asset',
              label: t('menu.asset'),
              items: [
                { id: 'new', label: t('menu.newAsset'), disabled: project === null },
                { id: 'rename', label: t('menu.renameAsset'), disabled: asset === null },
                { id: 'delete', label: t('menu.deleteAsset'), disabled: asset === null },
              ],
            },
          ]}
          onSelect={onCommand}
        >
          <Ellipsis />
        </Menu>
      </header>

      {message !== null && (
        <p className="px-1 text-xs text-fg-secondary" role="status">
          {message}
        </p>
      )}

      <nav aria-label={t('tree')} className="min-h-0 flex-1 overflow-auto">
        {projects.length === 0 ? (
          <Empty title={t('empty.projects')} hint={t('empty.projectsHint')} />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {projects.map((entry) => (
              <li key={entry.id}>
                <Row
                  label={entry.name}
                  selected={entry.id === projectId}
                  onSelect={() => {
                    void selectProject(entry.id);
                  }}
                />
                {entry.id === projectId && (
                  <AssetList
                    assets={assets}
                    assetId={assetId}
                    onSelect={(id) => {
                      void selectAsset(id);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </nav>

      <NamePrompt prompt={prompt} onClose={close} />
      <AssetPrompt open={prompt.kind === 'newAsset'} onClose={close} />
      <DeletePrompt prompt={prompt} onClose={close} />
    </aside>
  );
}

/** One project's sprites, indented under it. */
function AssetList({
  assets,
  assetId,
  onSelect,
}: {
  assets: Asset[];
  assetId: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation('projects');

  if (assets.length === 0) {
    return <Empty title={t('empty.assets')} hint={t('empty.assetsHint')} />;
  }

  return (
    <ul className="ms-3 mt-0.5 flex flex-col gap-0.5 border-s border-line-subtle ps-2">
      {assets.map((asset) => (
        <li key={asset.id}>
          <Row
            label={asset.name}
            // The size and the step, because they are the two facts that decide
            // what can be done to a sprite next and neither is recoverable from
            // its name.
            detail={t('assetMeta', {
              width: asset.width,
              height: asset.height,
              step: t(`steps.${asset.step}`),
            })}
            selected={asset.id === assetId}
            onSelect={() => {
              onSelect(asset.id);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** One selectable row of the tree. */
function Row({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors',
        selected
          ? 'bg-surface-content-alt text-fg-primary'
          : 'bg-transparent text-fg-secondary hover:bg-surface-content hover:text-fg-primary',
      )}
    >
      <span className="w-full truncate text-sm">{label}</span>
      {detail !== undefined && (
        <span className="w-full truncate text-xs text-fg-muted">{detail}</span>
      )}
    </button>
  );
}

/** What an empty branch of the tree says instead of showing nothing. */
function Empty({ title, hint }: { title: string; hint: string }): ReactElement {
  return (
    <div className="px-2 py-3">
      <p className="text-xs font-medium text-fg-secondary">{title}</p>
      <p className="mt-1 text-xs text-fg-muted">{hint}</p>
    </div>
  );
}

/**
 * Creating a project, and renaming either kind of row.
 *
 * One component for three forms because all three are a name and a button, and
 * the preset is the single field that only one of them has. Three components
 * would be three copies of the same trimming, the same disabled rule and the
 * same reset.
 */
function NamePrompt({ prompt, onClose }: { prompt: Prompt; onClose: () => void }): ReactElement {
  const { t } = useTranslation('projects');
  const createProject = useProjectStore((state) => state.createProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const renameAsset = useProjectStore((state) => state.renameAsset);

  const [name, setName] = useState('');
  const [preset, setPreset] = useState<StylePreset>(DEFAULT_PRESET);

  const open =
    prompt.kind === 'newProject' ||
    prompt.kind === 'renameProject' ||
    prompt.kind === 'renameAsset';

  useEffect(() => {
    // Seeded from whatever is being renamed, and emptied for a creation, every
    // time the form opens. Left alone it would show the last name typed into
    // it, which for a rename is another row's name.
    if (prompt.kind === 'renameProject') {
      setName(prompt.project.name);
    } else if (prompt.kind === 'renameAsset') {
      setName(prompt.asset.name);
    } else if (prompt.kind === 'newProject') {
      setName('');
      setPreset(DEFAULT_PRESET);
    }
  }, [prompt]);

  const confirm = (): void => {
    const trimmed = name.trim();
    if (prompt.kind === 'newProject') {
      void createProject(trimmed, preset);
    } else if (prompt.kind === 'renameProject') {
      void renameProject(prompt.project.id, trimmed);
    } else if (prompt.kind === 'renameAsset') {
      void renameAsset(prompt.asset.id, trimmed);
    }
    onClose();
  };

  const creating = prompt.kind === 'newProject';

  return (
    <Dialog
      open={open}
      title={t(titleKey(prompt))}
      confirmLabel={creating ? t('form.create') : t('form.rename')}
      confirmDisabled={name.trim() === ''}
      onDismiss={onClose}
      onConfirm={confirm}
    >
      <Field
        label={prompt.kind === 'renameAsset' ? t('form.assetName') : t('form.projectName')}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      {creating && (
        <Select
          label={t('form.preset')}
          hint={t('form.presetHint')}
          value={preset}
          options={STYLE_PRESETS.map((option) => ({
            value: option,
            label: t(`presets.${option}`),
          }))}
          onValueChange={(value) => {
            setPreset(asPreset(value));
          }}
        />
      )}
    </Dialog>
  );
}

/** Creating a sprite: a name, a kind, and the size it will keep. */
function AssetPrompt({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const { t } = useTranslation('projects');
  const createAsset = useProjectStore((state) => state.createAsset);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AssetKind>('character');
  const [width, setWidth] = useState(PRESET_CANVAS[DEFAULT_PRESET].width);
  const [height, setHeight] = useState(PRESET_CANVAS[DEFAULT_PRESET].height);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName('');
    setKind('character');
    // Seeded from the preset's canvas rather than from the last sprite made,
    // because the preset is the thing that says what size this style's sprites
    // are and the previous sprite is only what happened to be made before.
    setWidth(PRESET_CANVAS[DEFAULT_PRESET].width);
    setHeight(PRESET_CANVAS[DEFAULT_PRESET].height);
  }, [open]);

  return (
    <Dialog
      open={open}
      title={t('form.newAssetTitle')}
      confirmLabel={t('form.create')}
      confirmDisabled={name.trim() === ''}
      onDismiss={onClose}
      onConfirm={() => {
        void createAsset(name.trim(), kind, width, height);
        onClose();
      }}
    >
      <Field
        label={t('form.assetName')}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Select
        label={t('form.kind')}
        value={kind}
        options={ASSET_KINDS.map((option) => ({ value: option, label: t(`kinds.${option}`) }))}
        onValueChange={(value) => {
          setKind(asKind(value));
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={t('form.width')}
          value={width}
          min={MIN_SIZE}
          max={MAX_SIZE}
          onValueChange={setWidth}
        />
        <NumberField
          label={t('form.height')}
          value={height}
          min={MIN_SIZE}
          max={MAX_SIZE}
          onValueChange={setHeight}
        />
      </div>
      <p className="text-xs text-fg-secondary">{t('form.sizeHint')}</p>
    </Dialog>
  );
}

/** The two deletions, which say what goes with them. */
function DeletePrompt({ prompt, onClose }: { prompt: Prompt; onClose: () => void }): ReactElement {
  const { t } = useTranslation('projects');
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const deleteAsset = useProjectStore((state) => state.deleteAsset);

  const project = prompt.kind === 'deleteProject' ? prompt.project : null;
  const asset = prompt.kind === 'deleteAsset' ? prompt.asset : null;
  const name = project?.name ?? asset?.name ?? '';

  return (
    <ConfirmDialog
      open={project !== null || asset !== null}
      title={t(project !== null ? 'confirm.deleteProjectTitle' : 'confirm.deleteAssetTitle', {
        name,
      })}
      body={t(project !== null ? 'confirm.deleteProjectBody' : 'confirm.deleteAssetBody')}
      confirmLabel={t('confirm.delete')}
      onDismiss={onClose}
      onConfirm={() => {
        if (project !== null) {
          void deleteProject(project.id);
        } else if (asset !== null) {
          void deleteAsset(asset.id);
        }
        onClose();
      }}
    />
  );
}

/**
 * The heading for whichever name form is open.
 *
 * @param prompt - What the sidebar is currently asking.
 * @returns A key in the `projects` namespace.
 */
function titleKey(
  prompt: Prompt,
): 'form.newProjectTitle' | 'form.renameProjectTitle' | 'form.renameAssetTitle' {
  if (prompt.kind === 'renameProject') {
    return 'form.renameProjectTitle';
  }
  if (prompt.kind === 'renameAsset') {
    return 'form.renameAssetTitle';
  }
  return 'form.newProjectTitle';
}

/**
 * Narrows a select's answer back to a preset.
 *
 * `Select` speaks in strings because it is used by every screen, so the check
 * happens here rather than the value being asserted into the union. A value
 * that is not a preset cannot arrive - the options were built from the union -
 * and if one ever did, the default is a project that can still be created.
 *
 * @param value - What the control reported.
 * @returns The preset it names.
 */
function asPreset(value: string): StylePreset {
  return STYLE_PRESETS.find((preset) => preset === value) ?? DEFAULT_PRESET;
}

/**
 * Narrows a select's answer back to an asset kind, for the same reason.
 *
 * @param value - What the control reported.
 * @returns The kind it names.
 */
function asKind(value: string): AssetKind {
  return ASSET_KINDS.find((kind) => kind === value) ?? 'character';
}

/** The menu trigger's glyph: three dots, the standard for "more commands". */
function Ellipsis(): ReactElement {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3" fill="currentColor">
      <circle cx="2" cy="6" r="1" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="10" cy="6" r="1" />
    </svg>
  );
}
