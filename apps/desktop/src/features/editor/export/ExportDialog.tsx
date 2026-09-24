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
 * The export dialog: one asset, rendered at a chosen scale, written as a PNG
 * into a folder the person picks.
 *
 * THE FOLDER IS CHOSEN, NEVER TYPED. `export_png` writes wherever
 * `directory` names, so the only thing standing between this dialog and an
 * arbitrary write is the system picker in `pickDirectory` - there is no text
 * field for a path here, only the button that opens it.
 *
 * SCALE, PATTERN AND FOLDER ARE REMEMBERED FOR THE SESSION. Exporting is a
 * repeated action - the same folder and scale, asset after asset - so the
 * choice a person made last time is the choice they almost certainly want
 * again. It is kept in `localStorage` under one key rather than the document
 * store, because it has nothing to do with any one asset and should survive
 * switching between them.
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { pickDirectory } from '@/lib/api';
import { exportPng } from '@/lib/export';
import { DEFAULT_PATTERN, type ExportResult } from '@/types/export';

/** Scales the dialog offers, in ascending order. */
const SCALES = [1, 2, 4, 8, 16] as const;

const STORAGE_KEY = 'bitwright.export';

/** What is remembered for the session. */
interface ExportPrefs {
  directory: string | null;
  scale: number;
  pattern: string;
}

const DEFAULT_PREFS: ExportPrefs = { directory: null, scale: 1, pattern: DEFAULT_PATTERN };

/**
 * Reads the remembered folder, scale and pattern.
 *
 * Wrapped in try/catch because `localStorage` can throw in a restricted
 * webview; a dialog that cannot remember a choice should still open with a
 * sane default rather than fail to render.
 *
 * @returns The remembered preferences, or the defaults.
 */
function loadPrefs(): ExportPrefs {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_PREFS;
    }
    const parsed = JSON.parse(stored) as Partial<ExportPrefs>;
    return {
      directory: typeof parsed.directory === 'string' ? parsed.directory : null,
      scale:
        typeof parsed.scale === 'number' && (SCALES as readonly number[]).includes(parsed.scale)
          ? parsed.scale
          : DEFAULT_PREFS.scale,
      pattern: typeof parsed.pattern === 'string' ? parsed.pattern : DEFAULT_PREFS.pattern,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * Remembers the folder, scale and pattern for next time.
 *
 * @param prefs - The preferences to store.
 */
function savePrefs(prefs: ExportPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A choice that cannot be stored still applies for this dialog session.
  }
}

export interface ExportDialogProps {
  /** The asset to export. */
  assetId: string;
  /** Whether the dialog is showing. */
  open: boolean;
  /** Called when the dialog should close. */
  onClose: () => void;
}

/**
 * The export dialog.
 *
 * @returns A folder picker, a scale, a name pattern and an overwrite switch,
 *   which together export the asset as a PNG.
 */
export function ExportDialog({ assetId, open, onClose }: ExportDialogProps): ReactElement {
  const { t } = useTranslation('export');
  const translateError = useErrorMessage();

  const [prefs, setPrefs] = useState<ExportPrefs>(loadPrefs);
  const [overwrite, setOverwrite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (next: Partial<ExportPrefs>): void => {
    setPrefs((was) => {
      const merged = { ...was, ...next };
      savePrefs(merged);
      return merged;
    });
  };

  const chooseFolder = async (): Promise<void> => {
    const chosen = await pickDirectory();
    // A cancelled dialog resolves to null: the folder already chosen, if any,
    // is left in place rather than cleared.
    if (chosen !== null) {
      update({ directory: chosen });
    }
  };

  const runExport = async (): Promise<void> => {
    if (prefs.directory === null) {
      return;
    }
    setExporting(true);
    setError(null);
    setResult(null);
    const exported = await exportPng(
      assetId,
      prefs.directory,
      prefs.scale,
      prefs.pattern,
      overwrite,
    );
    setExporting(false);
    if (!exported.ok) {
      setError(exported.error.code);
      return;
    }
    setResult(exported.value);
  };

  const refusal = error !== null ? translateError(error) : null;

  return (
    <Dialog
      open={open}
      title={t('title')}
      confirmLabel={exporting ? t('exporting') : t('export')}
      confirmDisabled={prefs.directory === null || exporting}
      onDismiss={onClose}
      onConfirm={() => {
        void runExport();
      }}
    >
      <Field
        label={t('folder')}
        value={prefs.directory ?? t('noFolder')}
        readOnly
        trailing={
          <Button
            variant="ghost"
            className="px-2 py-1 text-[11px]"
            onClick={() => {
              void chooseFolder();
            }}
          >
            {t('chooseFolder')}
          </Button>
        }
      />

      <Select
        label={t('scale')}
        value={String(prefs.scale)}
        options={SCALES.map((scale) => ({ value: String(scale), label: `${scale}x` }))}
        onValueChange={(value) => {
          update({ scale: Number(value) });
        }}
      />

      <Field
        label={t('pattern')}
        value={prefs.pattern}
        hint={t('patternHint')}
        onChange={(event) => {
          update({ pattern: event.target.value });
        }}
      />

      <label className="flex items-center gap-2 text-xs font-medium text-fg-secondary">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(event) => {
            setOverwrite(event.target.checked);
          }}
          className="h-3.5 w-3.5 rounded-sm border-line-input"
        />
        {t('overwrite')}
      </label>

      {result !== null && (
        <p className="text-xs text-fg-secondary">
          {t('success', { path: result.path, width: result.width, height: result.height })}
        </p>
      )}

      {refusal !== null && (
        <div className="flex flex-col gap-1">
          <p
            role="alert"
            className="rounded-sm bg-surface-content-alt p-2 text-[11px] text-[color:var(--severity-error)]"
          >
            {refusal}
          </p>
          {error === 'export.exists' && (
            <p className="text-[11px] text-fg-secondary">{t('existsHint')}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
