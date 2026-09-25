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
 * The layers column: one row per role the workflow defines, top first.
 *
 * ROLES, NOT LAYERS. The workflow fixes which layers a sprite has - one per
 * role, created by the step that owns it - so the column lists every role
 * whether or not its layer exists yet, and there is no free "add layer". A
 * role whose layer has not been made is shown as such rather than left out,
 * because the list is also the workflow's map: it says which step will paint
 * each band.
 *
 * TOP FIRST, as every layer panel does: the accents at 71 are the first row
 * and the silhouette at 10 the last, so the list reads the way the composite
 * stacks.
 *
 * VISIBILITY AND LOCK ARE SHOWN, NOT SET. Both are columns on the layer row in
 * SQLite and both change what `document_composite` returns, and there is no
 * command in the shell that writes them: the registered set is `asset_*`,
 * `document_*`, `palette_*` and `step_*`, and none of them writes a layer's
 * flags. A toggle here would either lie - changing only what this window
 * draws, while the sprite an agent reads back is unchanged - or need a write
 * path that does not exist. So the eye is an indicator, and the row carries
 * the owning step and the pixel count, which are facts the artist can act on.
 *
 * CHOOSING A ROW CHOOSES WHERE THE NEXT STROKE GOES. Within the step's own
 * roles that is an ordinary choice: the shadow step owns the core band and the
 * deep band, and picking between them is the work. Outside them it is the act
 * the MCP tools spell `force`, and it is confirmed before it is set, because
 * the whole reason the steps are separate layers is that a finished one should
 * not be repainted by accident. "Draw on…" offers the same choice as a menu,
 * with the way back to following the step.
 */

import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, Layers, Lock } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { ownedRoles, paintTarget } from '@/features/editor/activeLayer';
import { useWorkflowLabels } from '@/features/editor/labels';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { LAYER_ROLES, STEPS, STEP_ROLES } from '@/types/document';
import type { Layer, LayerRole, Step } from '@/types/document';

/** The roles top first, which is the order a layer panel reads in. */
const TOP_FIRST: readonly LayerRole[] = [...LAYER_ROLES].reverse().map((entry) => entry.role);

/**
 * The step that paints each role.
 *
 * Derived from `STEP_ROLES` rather than written out, so the two tables cannot
 * disagree about which step a band belongs to.
 */
const OWNER: Readonly<Partial<Record<LayerRole, Step>>> = Object.fromEntries(
  STEPS.flatMap((step) => STEP_ROLES[step].map((role) => [role, step] as const)),
);

/**
 * The layers column.
 *
 * Fills the height it is given and scrolls its rows on its own.
 *
 * @returns The column.
 */
export function LayerList(): ReactElement {
  const { t } = useTranslation('panels');
  const { t: te } = useTranslation('editor');
  const labels = useWorkflowLabels();

  const layers = useDocumentStore((state) => state.layers);
  const step = useDocumentStore((state) => state.step);
  const targetRole = useEditorStore((state) => state.targetRole);
  const setTargetRole = useEditorStore((state) => state.setTargetRole);

  /** The role a confirmation is currently being asked about, or null. */
  const [confirming, setConfirming] = useState<LayerRole | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, menu, () => {
    setMenuOpen(false);
  });

  const owned = ownedRoles(step?.step ?? null);
  const active = paintTarget(step?.step ?? null, targetRole, layers).role;
  const byRole = new Map<LayerRole, Layer>(layers.map((layer) => [layer.role, layer]));

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
    <aside
      aria-label={t('layers.region')}
      className="w-64 bg-surface-canvas border-l border-line-subtle flex flex-col h-full shrink-0"
    >
      <div className="p-3 border-b border-line-subtle flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <Layers strokeWidth={1.75} className="w-4 h-4 text-fg-secondary" />
          <h3 className="text-xs font-semibold text-fg-primary">{te('layers.title')}</h3>
        </div>
        <div ref={menu} className="relative">
          <Button
            variant="secondary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t('layers.drawOnLabel')}
            disabled={step === null}
            onClick={() => {
              setMenuOpen((was) => !was);
            }}
            className="px-2 py-0.5 text-[11px]"
          >
            {t('layers.drawOn')}
          </Button>
          {menuOpen && (
            <ul
              role="menu"
              aria-label={t('layers.drawOnLabel')}
              className="absolute right-0 top-full mt-1 z-30 w-48 bg-surface-float border border-line-subtle p-1 rounded-lg shadow-md"
            >
              <MenuRow
                label={t('layers.followStep')}
                checked={targetRole === null}
                onSelect={() => {
                  setMenuOpen(false);
                  setTargetRole(null);
                }}
              />
              {TOP_FIRST.map((role) => (
                <MenuRow
                  key={role}
                  label={labels.layer[role]}
                  checked={targetRole === role}
                  disabled={!byRole.has(role)}
                  onSelect={() => {
                    setMenuOpen(false);
                    choose(role);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {step === null && layers.length === 0 ? (
          <p className="p-1 text-xs text-fg-secondary">{te('layers.none')}</p>
        ) : (
          <ul aria-label={t('layers.list')} className="space-y-1.5">
            {TOP_FIRST.map((role) => {
              const layer = byRole.get(role);
              const current = role === active;
              const owner = OWNER[role];
              return (
                <li key={role}>
                  <button
                    type="button"
                    aria-current={current}
                    disabled={layer === undefined}
                    onClick={() => {
                      choose(role);
                    }}
                    className={cn(
                      'w-full p-2 rounded-md border text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
                      // A layer not made yet is a disabled row: its own dim
                      // surface, not a faded copy of an enabled one.
                      layer === undefined
                        ? 'bg-surface-disabled border-line-subtle cursor-not-allowed'
                        : current
                          ? 'bg-surface-content-alt border-accent shadow-sm'
                          : 'bg-surface-content border-line-subtle hover:bg-surface-content-alt',
                    )}
                  >
                    <span className="flex items-center space-x-2">
                      {layer !== undefined &&
                        (layer.visible ? (
                          <Eye
                            role="img"
                            aria-label={t('layers.visible')}
                            strokeWidth={1.75}
                            className="w-3.5 h-3.5 shrink-0 text-fg-secondary"
                          />
                        ) : (
                          <EyeOff
                            role="img"
                            aria-label={t('layers.hidden')}
                            strokeWidth={1.75}
                            className="w-3.5 h-3.5 shrink-0 text-fg-secondary"
                          />
                        ))}
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-xs',
                          layer === undefined
                            ? 'text-fg-muted'
                            : current
                              ? 'text-fg-primary font-semibold'
                              : 'text-fg-primary',
                        )}
                      >
                        {labels.layer[role]}
                      </span>
                      {layer?.locked === true && (
                        <Lock
                          role="img"
                          aria-label={t('layers.locked')}
                          strokeWidth={1.75}
                          className="w-3 h-3 shrink-0 text-[color:var(--severity-warning)]"
                        />
                      )}
                      <span
                        className={cn(
                          'shrink-0 text-[11px]',
                          layer === undefined ? 'text-fg-muted' : 'text-fg-secondary',
                        )}
                      >
                        {owned.includes(role)
                          ? t('layers.thisStep')
                          : owner === undefined
                            ? ''
                            : t('layers.ownedBy', { step: labels.step[owner] })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'mt-2 pt-1.5 border-t border-line-subtle flex justify-between text-[11px] tabular-nums',
                        layer === undefined ? 'text-fg-muted' : 'text-fg-secondary',
                      )}
                    >
                      {layer === undefined ? (
                        <span>{t('layers.missing')}</span>
                      ) : (
                        <>
                          <span>{t('layers.pixels', { count: paintedPixels(layer) })}</span>
                          <span>
                            {t('layers.opacity', { percent: Math.round(layer.opacity * 100) })}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={te('layers.forceTitle')}
        // Names the layer and the step, because the thing being agreed to is
        // the pair: this layer belongs to a step that is finished, and the one
        // in progress is somewhere else.
        body={te('layers.forceBody', {
          layer: confirming === null ? '' : labels.layer[confirming],
          step: step === null ? '' : labels.step[step.step],
        })}
        confirmLabel={te('layers.forceConfirm')}
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
    </aside>
  );
}

interface MenuRowProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * One choice in the "Draw on…" menu.
 *
 * @param props - What it is called, whether it is the current choice, and
 *   what choosing it does.
 * @returns The row.
 */
function MenuRow({ label, checked, disabled = false, onSelect }: MenuRowProps): ReactElement {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        disabled={disabled}
        onClick={onSelect}
        className="w-full flex items-center justify-between px-2 py-1 rounded-sm text-left text-xs text-fg-primary hover:bg-surface-content-alt disabled:text-fg-muted disabled:hover:bg-transparent disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus"
      >
        <span className="truncate">{label}</span>
        {checked && <Check strokeWidth={1.75} className="w-3 h-3 text-fg-primary" />}
      </button>
    </li>
  );
}

/**
 * How many pixels a layer has painted.
 *
 * @param layer - The layer.
 * @returns The count of non-transparent pixels.
 */
function paintedPixels(layer: Layer): number {
  let count = 0;
  for (const value of layer.buffer.data) {
    if (value !== 0) {
      count += 1;
    }
  }
  return count;
}
