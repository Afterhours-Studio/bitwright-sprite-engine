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
 * The right-hand panel: the palette, the layers, and the step.
 *
 * IN THAT ORDER, AND THE ORDER IS THE ARGUMENT. A stroke is decided by three
 * things in sequence - which slot it writes, which layer it lands on, and which
 * step owns that layer - so the panel reads downward in the order the decisions
 * are made, and the step rail is at the bottom because it is the thing acted on
 * last and least often.
 *
 * The step rail is also the only section that can move the sprite forward, and
 * it sits below the two sections that say what the work looks like now, so
 * "advance" is never the first control the eye lands on.
 *
 * Everything here reads `useDocumentStore`, which holds a view of the database
 * and never the document itself. A panel that cached what it drew would be a
 * second copy for an agent's write to disagree with.
 */

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { LayerList } from '@/features/editor/tools/LayerList';
import { PalettePanel } from '@/features/editor/tools/PalettePanel';
import { StepRail } from '@/features/editor/tools/StepRail';

/**
 * The tool panel.
 *
 * @returns The three sections, stacked and scrollable.
 */
export function ToolPanel(): ReactElement {
  const { t } = useTranslation('editor');

  return (
    <aside
      aria-label={t('panel.label')}
      className="flex min-h-0 w-full flex-col gap-4 overflow-y-auto p-2"
    >
      <PalettePanel />
      <hr className="border-line-subtle" />
      <LayerList />
      <hr className="border-line-subtle" />
      <StepRail />
    </aside>
  );
}
