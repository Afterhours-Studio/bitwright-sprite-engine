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
 * The reference panel: a picture imported to draw against, conformed to the
 * asset's own size by the sidecar so it lines up pixel for pixel with the
 * canvas.
 *
 * IMPORT NEVER TOUCHES THE DOCUMENT. `reference_import` writes a reference row
 * beside the asset; nothing here calls `document_write_ops`. Applying a
 * reference's palette is the one bridge between the two, and it goes through
 * `reference_apply_palette`, which is checked exactly as `palette_write` is -
 * a rejection names the rule it broke rather than partially recolouring the
 * document.
 *
 * THE PREVIEW IS A DATA URL, READ ON DEMAND. References are not carried in
 * the document store because they are not part of the document a save reads
 * back; they are fetched for whichever one is selected and thrown away when
 * the selection moves on.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import {
  referenceApplyPalette,
  referenceDelete,
  referenceImport,
  referenceList,
  referencePickFile,
  referencePreview,
} from '@/lib/reference';
import { useDocumentStore } from '@/stores/useDocumentStore';
import type { ReferenceSummary } from '@/types/reference';

/**
 * The reference panel.
 *
 * @returns The list of references for the open asset, a preview of the
 *   selected one, and the actions on it.
 */
export function ReferencePanel(): ReactElement {
  const { t } = useTranslation('reference');
  const translateError = useErrorMessage();

  const assetId = useDocumentStore((state) => state.assetId);

  const [references, setReferences] = useState<ReferenceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Lists references for the open asset, newest first, and selects one.
   *
   * @param pickId - The reference to select once the list is in, or null to
   *   select the newest.
   */
  const refresh = async (pickId?: string | null): Promise<void> => {
    if (assetId === null) {
      return;
    }
    const listed = await referenceList(assetId);
    // The alert speaks for the latest operation only, so a success clears it.
    if (listed.ok) {
      setError(null);
    }
    if (!listed.ok) {
      setError(listed.error.code);
      return;
    }
    const sorted = [...listed.value].sort((left, right) => right.createdAt - left.createdAt);
    setReferences(sorted);
    const next = pickId ?? sorted[0]?.id ?? null;
    setSelected(next);
  };

  useEffect(() => {
    setReferences([]);
    setSelected(null);
    setPreview(null);
    setError(null);
    if (assetId !== null) {
      void refresh();
    }
    // `refresh` closes over `assetId`, so it is intentionally not a
    // dependency: it is re-created on every render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (assetId === null || selected === null) {
      return;
    }
    const run = { cancelled: false };
    void (async () => {
      const read = await referencePreview(assetId, selected);
      if (run.cancelled) {
        return;
      }
      if (!read.ok) {
        setError(read.error.code);
        return;
      }
      setPreview(read.value);
    })();
    return () => {
      run.cancelled = true;
    };
  }, [assetId, selected]);

  if (assetId === null) {
    return <p className="text-xs text-fg-secondary">{t('noDocument')}</p>;
  }

  const chosen = references.find((reference) => reference.id === selected) ?? null;

  const handleImport = async (): Promise<void> => {
    setError(null);
    setImporting(true);
    const picked = await referencePickFile();
    if (!picked.ok) {
      setError(picked.error.code);
      setImporting(false);
      return;
    }
    if (picked.value === null) {
      setImporting(false);
      return;
    }
    const imported = await referenceImport(assetId, picked.value);
    setImporting(false);
    if (!imported.ok) {
      setError(imported.error.code);
      return;
    }
    await refresh(imported.value.id);
  };

  const handleApplyPalette = async (): Promise<void> => {
    if (chosen === null) {
      return;
    }
    setError(null);
    const applied = await referenceApplyPalette(assetId, chosen.id);
    if (!applied.ok) {
      setError(applied.error.code);
      return;
    }
    useDocumentStore.setState({ palette: applied.value });
  };

  const handleDelete = async (): Promise<void> => {
    if (chosen === null) {
      return;
    }
    setConfirmingDelete(false);
    setError(null);
    const deleted = await referenceDelete(assetId, chosen.id);
    if (!deleted.ok) {
      setError(deleted.error.code);
      return;
    }
    await refresh();
  };

  const refusal = error !== null ? translateError(error) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-primary">{t('title')}</h3>
        <Button
          variant="ghost"
          className="px-2 py-1 text-[11px]"
          disabled={importing}
          onClick={() => {
            void handleImport();
          }}
        >
          {importing ? t('importing') : t('import')}
        </Button>
      </div>

      {references.length === 0 ? (
        <p className="text-xs text-fg-secondary">{t('empty')}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {references.map((reference) => (
            <button
              key={reference.id}
              type="button"
              aria-pressed={reference.id === selected}
              onClick={() => {
                setSelected(reference.id);
              }}
              className="rounded-sm border border-line-subtle px-2 py-1 text-[11px] text-fg-secondary aria-pressed:border-accent aria-pressed:text-fg-primary"
            >
              {reference.name}
            </button>
          ))}
        </div>
      )}

      {chosen !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-line-subtle bg-surface-content-alt p-2">
          {preview !== null && (
            <img
              src={preview}
              alt={t('previewAlt', { name: chosen.name })}
              style={{ imageRendering: 'pixelated' }}
              className="max-h-40 w-auto self-start"
            />
          )}
          <p className="text-[11px] font-medium text-fg-primary">{chosen.name}</p>
          <p className="text-[11px] text-fg-secondary">
            {t('size', { width: chosen.width, height: chosen.height })}
          </p>
          <p className="text-[11px] text-fg-secondary">
            {chosen.detected === null
              ? t('noGrid')
              : t('grid', {
                  width: chosen.detected.cellWidth,
                  height: chosen.detected.cellHeight,
                  confidence: Math.round(chosen.detected.confidence * 100),
                })}
          </p>
          {chosen.palette.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chosen.palette.map((hex, index) => (
                <span
                  key={`${hex}-${index}`}
                  title={hex}
                  className="h-5 w-5 rounded-sm border border-line-subtle"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          )}
          {chosen.warnings.map((code) => (
            <p key={code} className="text-[11px] text-fg-secondary">
              {t(`warnings.${code}`, { defaultValue: code })}
            </p>
          ))}

          <div className="mt-1 flex gap-2">
            <Button
              variant="secondary"
              className="px-2 py-1 text-[11px]"
              onClick={() => {
                void handleApplyPalette();
              }}
            >
              {t('applyPalette')}
            </Button>
            <Button
              variant="danger"
              className="px-2 py-1 text-[11px]"
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              {t('delete')}
            </Button>
          </div>
        </div>
      )}

      {refusal !== null && (
        <p
          role="alert"
          className="rounded-sm bg-surface-content-alt p-2 text-[11px] text-[color:var(--severity-error)]"
        >
          {refusal}
        </p>
      )}

      <Dialog
        open={confirmingDelete}
        title={t('deleteTitle')}
        confirmLabel={t('delete')}
        destructive
        onDismiss={() => {
          setConfirmingDelete(false);
        }}
        onConfirm={() => {
          void handleDelete();
        }}
      >
        <p className="text-xs text-fg-secondary">
          {chosen === null ? '' : t('deleteBody', { name: chosen.name })}
        </p>
      </Dialog>
    </div>
  );
}
