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
 *
 * AN ANIMATION HAS THREE OUTPUTS. When the open asset is a frame of an
 * animation of more than one frame, the dialog offers this frame as a PNG (as
 * for a lone sprite), the whole animation as a looping GIF, and a sprite sheet
 * of every frame in timeline order. Folder, scale and pattern are the same
 * three choices for all of them, so switching output never loses what was
 * set; the pattern's `{asset}` is the animation's name - its root's - for the
 * GIF and the sheet. A lone sprite's dialog is the PNG one and nothing else.
 */

import { Download } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { NumberField } from '@/components/ui/NumberField';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Select } from '@/components/ui/Select';
import { expandPattern, gifPath, type NameParts } from '@/features/editor/export/exportName';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { exportGif } from '@/lib/animation';
import { pickDirectory } from '@/lib/api';
import { exportPng, exportSheet } from '@/lib/export';
import type { ShellResult } from '@/lib/tauri';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Frame } from '@/types/animation';
import { DEFAULT_PATTERN, type ExportResult } from '@/types/export';

/** Scales the dialog offers, in ascending order. */
const SCALES = [1, 2, 4, 8, 16] as const;

const STORAGE_KEY = 'bitwright.export';

/** What an animation can be exported as. */
type Output = 'png' | 'gif' | 'sheet';

/** Every output, in the order the tabs offer them. */
const OUTPUTS: readonly Output[] = ['png', 'gif', 'sheet'];

const OUTPUT_LABEL = {
  png: 'outputPng',
  gif: 'outputGif',
  sheet: 'outputSheet',
} as const satisfies Record<Output, string>;

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
 *   which together export the asset as a PNG - or, for an animation, as a PNG
 *   of this frame, a GIF or a sprite sheet.
 */
export function ExportDialog({ assetId, open, onClose }: ExportDialogProps): ReactElement {
  const { t } = useTranslation('export');
  const translateError = useErrorMessage();

  const [prefs, setPrefs] = useState<ExportPrefs>(loadPrefs);
  const [overwrite, setOverwrite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<Output>('png');
  const [columns, setColumns] = useState<number | null>(null);

  const animation = useAnimationStore((state) => state.animation);
  const allAssets = useProjectStore((state) => state.allAssets);
  const projectAssets = useProjectStore((state) => state.assets);
  const projects = useProjectStore((state) => state.projects);

  // Only an animation this asset is a frame of counts: the store follows the
  // open document, and the dialog could be asked about another asset.
  const frames: Frame[] | null =
    animation !== null &&
    animation.frames.length > 1 &&
    animation.frames.some((frame) => frame.assetId === assetId)
      ? animation.frames
      : null;
  const mode: Output = frames === null ? 'png' : output;
  const frameCount = frames?.length ?? 1;
  // Columns follow the frame count until someone sets them, so a frame added
  // while the dialog is open still lands on the one row.
  const sheetColumns = Math.min(Math.max(columns ?? frameCount, 1), frameCount);

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

  /**
   * What the pattern's placeholders stand for when the dialog fills them in
   * itself: the animation is named by its root, the kind is the open asset's.
   *
   * @param all - The animation's frames, root first.
   * @returns The parts, at the chosen scale.
   */
  const nameParts = (all: Frame[]): NameParts => {
    const row =
      allAssets.find((asset) => asset.id === assetId) ??
      projectAssets.find((asset) => asset.id === assetId);
    const project = projects.find((entry) => entry.id === row?.projectId);
    return {
      project: project?.name ?? '',
      asset: all[0]?.name ?? '',
      kind: row?.kind ?? '',
      scale: prefs.scale,
    };
  };

  /**
   * Exports the animation as a GIF or a sheet into `directory`.
   *
   * @param directory - The folder the person picked.
   * @param all - The animation's frames, in timeline order.
   * @returns What the shell answered.
   */
  const exportAnimation = (directory: string, all: Frame[]): Promise<ShellResult<ExportResult>> => {
    const parts = nameParts(all);
    if (mode === 'gif') {
      const path = gifPath(directory, prefs.pattern, parts);
      if (path === null) {
        return Promise.resolve({
          ok: false,
          error: { code: 'export.invalid_pattern', detail: prefs.pattern },
        });
      }
      return exportGif(assetId, prefs.scale, path);
    }
    // `{project}` is left for the shell, which reads it from the first frame;
    // `{asset}` and `{kind}` are filled here, or they would come out "sheet".
    return exportSheet(
      all.map((frame) => frame.assetId),
      directory,
      sheetColumns,
      prefs.scale,
      expandPattern(prefs.pattern, parts, true),
      overwrite,
    );
  };

  const runExport = async (): Promise<void> => {
    if (prefs.directory === null) {
      return;
    }
    setExporting(true);
    setError(null);
    setResult(null);
    const exported =
      mode === 'png' || frames === null
        ? await exportPng(assetId, prefs.directory, prefs.scale, prefs.pattern, overwrite)
        : await exportAnimation(prefs.directory, frames);
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
      icon={<Download />}
      size="md"
      confirmLabel={exporting ? t('exporting') : t('export')}
      confirmDisabled={prefs.directory === null || exporting}
      onDismiss={onClose}
      onConfirm={() => {
        void runExport();
      }}
    >
      {frames !== null && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-neutral-300">{t('output')}</span>
          <SegmentedTabs
            label={t('output')}
            value={mode}
            segments={OUTPUTS.map((value) => ({ value, label: t(OUTPUT_LABEL[value]) }))}
            onValueChange={(value) => {
              setOutput(OUTPUTS.find((entry) => entry === value) ?? 'png');
              setResult(null);
              setError(null);
            }}
            className="self-start"
          />
          {mode === 'gif' && (
            <p className="text-[11px] text-neutral-500">{t('gifHint', { count: frameCount })}</p>
          )}
          {mode === 'sheet' && (
            <p className="text-[11px] text-neutral-500">{t('sheetHint', { count: frameCount })}</p>
          )}
        </div>
      )}

      <Field
        label={t('folder')}
        value={prefs.directory ?? t('noFolder')}
        readOnly
        trailing={
          <Button
            variant="secondary"
            className="px-2 py-0.5 text-[11px]"
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

      {mode === 'sheet' && (
        <NumberField
          label={t('columns')}
          value={sheetColumns}
          min={1}
          max={frameCount}
          stepper
          onValueChange={(value) => {
            setColumns(value);
          }}
        />
      )}

      {/* `export_gif` takes a finished path and has no overwrite switch, so
          the box is not offered where it would do nothing. */}
      {mode !== 'gif' && (
        <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-300">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => {
              setOverwrite(event.target.checked);
            }}
            className="h-3.5 w-3.5 rounded-sm border-neutral-700 accent-pink-600"
          />
          {t('overwrite')}
        </label>
      )}

      {result !== null && (
        <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] break-all text-emerald-400">
          {mode === 'gif'
            ? t('successGif', {
                path: result.path,
                width: result.width,
                height: result.height,
                count: frameCount,
              })
            : t('success', { path: result.path, width: result.width, height: result.height })}
        </p>
      )}

      {refusal !== null && (
        <div className="flex flex-col gap-1">
          <p
            role="alert"
            className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-400"
          >
            {refusal}
          </p>
          {error === 'export.exists' && (
            <p className="text-[11px] text-neutral-500">{t('existsHint')}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
