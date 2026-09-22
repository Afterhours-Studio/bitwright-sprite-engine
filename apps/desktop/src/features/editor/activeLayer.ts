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
 * Which layer the next stroke writes to, and whether it is allowed to.
 *
 * THE STEP OWNS THE LAYER. An asset at the `flats` step writes to `flats`, and
 * that is the default with no decision to make. A step that owns two roles -
 * `shadow` owns the core and the deep band, `accent` owns the rim and the
 * accents - offers both, and choosing between them is an ordinary choice
 * inside the step rather than an override of it.
 *
 * WRITING OUTSIDE THE STEP IS THE DELIBERATE ACT the MCP tools call `force`.
 * Every MCP write refuses a layer the current step does not own unless `force`
 * is passed; the renderer has no such argument on `document_write_ops`, so the
 * refusal is made here and the deliberate act is a confirmation the user gives
 * before the override is set. Revisiting an earlier step is legitimate; doing
 * it with a stray click on a finished layer is not, and the two are told apart
 * by whether anybody was asked.
 *
 * FOUR STEPS PAINT NOTHING. `reference` and `palette` write to their own
 * tables, `cleanup` works over the layers that already exist and `variation`
 * forks the asset. On any of them there is no owned role, and a stroke has
 * nowhere to go that would not be an override of the workflow.
 */

import { STEP_ROLES, type LayerRole, type Step } from '@/types/document';

/** Why a stroke cannot be made, or that it can. */
export type PaintRefusal =
  /** The stroke will commit. */
  | 'ready'
  /** No document is open. */
  | 'no-document'
  /** The step paints no layer at all. */
  | 'step-paints-nothing'
  /** The chosen layer has not been created in this document. */
  | 'no-layer'
  /** The chosen layer is locked, and Rust would refuse the write. */
  | 'locked';

/** What the next stroke would do, before it is made. */
export interface PaintTarget {
  /** The layer it writes to, or null when there is none to write to. */
  role: LayerRole | null;
  /** Whether that layer belongs to the step the asset is on. */
  owned: boolean;
  /** Whether a stroke would commit, and if not, why not. */
  refusal: PaintRefusal;
}

/**
 * The roles the step owns, which are the ones a stroke may pick between
 * without anybody being asked.
 *
 * @param step - Where the asset is in the workflow, or null when none is open.
 * @returns The owned roles, in the order the step fills them.
 */
export function ownedRoles(step: Step | null): readonly LayerRole[] {
  return step === null ? [] : STEP_ROLES[step];
}

/**
 * Resolves what the next stroke would write to.
 *
 * @param step - Where the asset is, or null when none is open.
 * @param override - The layer the user deliberately chose, or null to follow
 *   the step.
 * @param layers - The document's layers, which say what exists and what is
 *   locked.
 * @returns The target, and whether a stroke would land.
 */
export function paintTarget(
  step: Step | null,
  override: LayerRole | null,
  layers: readonly { role: LayerRole; locked: boolean }[],
): PaintTarget {
  if (step === null) {
    return { role: null, owned: false, refusal: 'no-document' };
  }

  const owned = ownedRoles(step);
  // The override wins when there is one, including when it names a role the
  // step happens to own: choosing the deep shadow band over the core band is
  // the same choice either way, and treating it as an override there would
  // make the interface ask a question it already has the answer to.
  const role = override ?? owned[0] ?? null;
  if (role === null) {
    return { role: null, owned: false, refusal: 'step-paints-nothing' };
  }

  const isOwned = owned.includes(role);
  const layer = layers.find((candidate) => candidate.role === role);
  if (layer === undefined) {
    return { role, owned: isOwned, refusal: 'no-layer' };
  }
  if (layer.locked) {
    // Refused here as well as in Rust. The write would come back
    // `document.layer_locked`, which is the correct answer arriving after the
    // stroke was drawn, and a lock that only reports itself afterwards reads
    // as an editor that lost the stroke.
    return { role, owned: isOwned, refusal: 'locked' };
  }
  return { role, owned: isOwned, refusal: 'ready' };
}
