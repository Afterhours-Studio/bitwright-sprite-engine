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
 * The layers, by role, in the order they composite.
 *
 * ORDINAL ORDER, LOW FIRST, which is bottom to top: the silhouette at 10 is
 * underneath everything and the accents at 71 are on top. Listed in that order
 * rather than reversed, because the ordinals are the document's own numbers and
 * a list that shows 71 first while calling it the top would have two directions
 * on screen at once.
 *
 * VISIBILITY AND LOCK ARE SHOWN, NOT SET. Both are columns on the layer row in
 * SQLite and both change what `document_composite` returns, and there is no
 * command in the shell that writes them: the registered set is `asset_*`,
 * `document_*`, `palette_*` and `step_*`, and none of them writes a layer's
 * flags. A switch here would either lie - changing only what this window draws,
 * while the sprite an agent reads back is unchanged - or need a write path
 * that does not exist. They are reported instead, because a locked layer
 * refusing a stroke is something the artist has to be able to see the reason
 * for.
 *
 * CHOOSING A ROW CHOOSES WHERE THE NEXT STROKE GOES. Within the step's own
 * roles that is an ordinary choice: the shadow step owns the core band and the
 * deep band, and picking between them is the work. Outside them it is the act
 * the MCP tools spell `force`, and it is confirmed before it is set, because
 * the whole reason the steps are separate layers is that a finished one should
 * not be repainted by accident.
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { ownedRoles, paintTarget } from '@/features/editor/activeLayer';
import { useWorkflowLabels } from '@/features/editor/labels';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import type { LayerRole } from '@/types/document';

/**
 * The layer list.
 *
 * @returns One row per layer the document has.
 */
export function LayerList(): ReactElement {
  const { t } = useTranslation('editor');
  const labels = useWorkflowLabels();

  const layers = useDocumentStore((state) => state.layers);
  const step = useDocumentStore((state) => state.step);
  const targetRole = useEditorStore((state) => state.targetRole);
  const setTargetRole = useEditorStore((state) => state.setTargetRole);

  /** The role a confirmation is currently being asked about, or null. */
  const [confirming, setConfirming] = useState<LayerRole | null>(null);

  const owned = ownedRoles(step?.step ?? null);
  const active = paintTarget(step?.step ?? null, targetRole, layers).role;
  const ordered = [...layers].sort((a, b) => a.ordinal - b.ordinal);

  /**
   * Points the next stroke at a layer, asking first when that leaves the step.
   *
   * @param role - The layer the row stands for.
   */
  const choose = (role: LayerRole): void => {
    if (owned.includes(role)) {
      setTargetRole(role);
      return;
    }
    setConfirming(role);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-primary">{t('layers.title')}</h3>
        {targetRole !== null && (
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-[11px]"
            onClick={() => {
              setTargetRole(null);
            }}
          >
            {t('layers.followStep')}
          </Button>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="text-xs text-fg-secondary">{t('layers.none')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {ordered.map((layer) => {
            const isOwned = owned.includes(layer.role);
            return (
              <li key={layer.id}>
                <button
                  type="button"
                  aria-current={layer.role === active}
                  onClick={() => {
                    choose(layer.role);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs',
                    'transition-colors',
                    layer.role === active
                      ? 'bg-surface-content-alt text-fg-primary'
                      : 'text-fg-secondary hover:bg-surface-content-alt hover:text-fg-primary',
                  )}
                >
                  <span className="w-6 shrink-0 text-[10px] tabular-nums text-fg-muted">
                    {layer.ordinal}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{labels.layer[layer.role]}</span>
                  {/* The step's own roles are marked rather than the others,
                      because the mark means "this is where the work is now"
                      and the rest of the list is history and future. */}
                  {isOwned && (
                    <span className="shrink-0 text-[10px] text-fg-muted">
                      {t('layers.thisStep')}
                    </span>
                  )}
                  {!layer.visible && (
                    <span className="shrink-0 text-[10px] text-fg-muted">{t('layers.hidden')}</span>
                  )}
                  {layer.locked && (
                    <span className="shrink-0 text-[10px] text-fg-muted">{t('layers.locked')}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={t('layers.forceTitle')}
        // Names the layer and the step, because the thing being agreed to is
        // the pair: this layer belongs to a step that is finished, and the one
        // in progress is somewhere else.
        body={t('layers.forceBody', {
          layer: confirming === null ? '' : labels.layer[confirming],
          step: step === null ? '' : labels.step[step.step],
        })}
        confirmLabel={t('layers.forceConfirm')}
        onConfirm={() => {
          if (confirming !== null) {
            setTargetRole(confirming);
          }
          setConfirming(null);
        }}
        onDismiss={() => {
          setConfirming(null);
        }}
      />
    </div>
  );
}
