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

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { DocumentCanvas } from '@/features/editor/canvas/DocumentCanvas';
import { StudioHeader } from '@/features/editor/header/StudioHeader';
import { AgentActivityIndicator } from '@/features/editor/live';
import { TilemapEditor } from '@/features/editor/tilemap/TilemapEditor';
import { LayerList } from '@/features/editor/tools/LayerList';
import { PalettePanel } from '@/features/editor/tools/PalettePanel';
import { StepRail } from '@/features/editor/tools/StepRail';
import { ToolColumn } from '@/features/editor/tools/ToolColumn';
import { useToolShortcuts } from '@/hooks/useToolShortcuts';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';

/**
 * The editor, laid out as the studio: the header across the top, the tools
 * column, the stage and the colour and layers panels in one row under it, and
 * the steps strip along the bottom (docs/architecture/studio-layout.md,
 * "Editor").
 *
 * WHAT IS ON THE STAGE, AND HOW IT GOT THERE.
 *
 * The document that is open: an asset in SQLite, composited from its indexed
 * layers by Rust. The screen is written against "the document that is open"
 * and not against who opened it, which is what lets an agent drawing over MCP
 * and a person drawing with a pencil arrive on the same stage by the same
 * route. A background asset is the one exception: it has no pixels of its own
 * to composite, only a grid of tile ids, so the stage shows `TilemapEditor`
 * instead of `DocumentCanvas` for it. `key={assetId}` is what throws the
 * tilemap editor's own state away when the open asset changes, rather than
 * leaving it showing the previous background's map for a beat.
 *
 * The agent-activity chip sits over the top left of the stage, whichever of
 * the two is on it, because an agent can be drawing on a background too.
 *
 * WHAT MOVED OUT. Export, the reference panel, the notification bell and the
 * toast anchor are the header's; the brush and shape settings are the tools
 * column's and the colour panel's; the view toggles are the header's and the
 * command palette's, which is also where the checkerboard is reached now.
 *
 * The steps strip is in a `relative` container of its own and nothing between
 * it and the window clips upward, so the gate report's popover, which opens
 * above the strip, lays out against the strip and paints over the stage.
 */
export function EditorScreen(): ReactElement {
  const { t } = useTranslation('editor');
  useToolShortcuts();

  const assetId = useDocumentStore((state) => state.assetId);
  const background = useDocumentStore((state) => state.asset?.kind === 'background');
  const showLayersPanel = useEditorStore((state) => state.showLayersPanel);
  const showStepsStrip = useEditorStore((state) => state.showStepsStrip);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-neutral-950 text-neutral-100">
      <StudioHeader />

      <div className="flex flex-1 overflow-hidden relative min-h-0">
        <ToolColumn />

        <main
          aria-label={t('stage.label')}
          className="relative flex min-w-0 flex-1 h-full overflow-hidden canvas-workspace-bg"
        >
          {assetId !== null && background ? (
            <TilemapEditor key={assetId} assetId={assetId} />
          ) : (
            <DocumentCanvas />
          )}
          <div className="pointer-events-none absolute left-4 top-4 z-10">
            <AgentActivityIndicator />
          </div>
        </main>

        <div className="flex h-full shrink-0">
          <PalettePanel />
          {showLayersPanel && <LayerList />}
        </div>
      </div>

      {showStepsStrip && (
        <div className="relative shrink-0">
          <StepRail />
        </div>
      )}
    </div>
  );
}
