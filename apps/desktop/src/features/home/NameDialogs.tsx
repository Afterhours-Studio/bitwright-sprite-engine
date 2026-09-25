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
 * The small forms home opens: a new project, and a rename of either kind of
 * row. Each is a name and a button, so each is the shared `Dialog` with a
 * field in it rather than a panel of its own.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { useProjectStore } from '@/stores/useProjectStore';
import { DEFAULT_PRESET, STYLE_PRESETS, type StylePreset } from '@/types/document';

export interface NewProjectDialogProps {
  /** Whether the dialog is showing. */
  open: boolean;
  /** Called when it should close, after creating or not. */
  onClose: () => void;
}

/** Creating a project: a name, and the style preset it is checked against. */
export function NewProjectDialog({ open, onClose }: NewProjectDialogProps): ReactElement {
  const { t } = useTranslation('projects');
  const createProject = useProjectStore((state) => state.createProject);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<StylePreset>(DEFAULT_PRESET);

  useEffect(() => {
    // Emptied each time it opens, so it never offers the last project's name.
    if (open) {
      setName('');
      setPreset(DEFAULT_PRESET);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      title={t('form.newProjectTitle')}
      confirmLabel={t('form.create')}
      confirmDisabled={name.trim() === ''}
      onDismiss={onClose}
      onConfirm={() => {
        void createProject(name.trim(), preset);
        onClose();
      }}
    >
      <Field
        label={t('form.projectName')}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Select
        label={t('form.preset')}
        hint={t('form.presetHint')}
        value={preset}
        options={STYLE_PRESETS.map((option) => ({ value: option, label: t(`presets.${option}`) }))}
        onValueChange={(value) => {
          setPreset(STYLE_PRESETS.find((option) => option === value) ?? DEFAULT_PRESET);
        }}
      />
    </Dialog>
  );
}

export interface RenameDialogProps {
  /** Whether the dialog is showing. */
  open: boolean;
  /** Heading. A translated string. */
  title: string;
  /** The field's label. A translated string. */
  label: string;
  /** The name the field starts with. */
  initial: string;
  /** Called when it should close without renaming. */
  onClose: () => void;
  /** Called with the trimmed new name. */
  onRename: (name: string) => void;
}

/** Renaming a project or a sprite. */
export function RenameDialog({
  open,
  title,
  label,
  initial,
  onClose,
  onRename,
}: RenameDialogProps): ReactElement {
  const { t } = useTranslation('projects');
  const [name, setName] = useState(initial);

  useEffect(() => {
    // Seeded from the row being renamed every time it opens; left alone it
    // would show the last name typed, which is another row's.
    if (open) {
      setName(initial);
    }
  }, [open, initial]);

  return (
    <Dialog
      open={open}
      title={title}
      confirmLabel={t('form.rename')}
      confirmDisabled={name.trim() === ''}
      onDismiss={onClose}
      onConfirm={() => {
        onRename(name.trim());
      }}
    >
      <Field
        label={label}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
    </Dialog>
  );
}
