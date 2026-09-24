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

import {
  Dock,
  DockChoices,
  DockEntry,
  DockPopover,
  type DockChoice,
} from '@/components/layout/Dock';
import { IconButton } from '@/components/ui/IconButton';
import { NotificationList } from '@/components/ui/NotificationList';
import { Toggle } from '@/components/ui/Field';
import { NumberField } from '@/components/ui/NumberField';
import { Pill } from '@/components/ui/Pill';
import { Tooltip } from '@/components/ui/Tooltip';
import { DocumentCanvas } from '@/features/editor/canvas/DocumentCanvas';
import { ExportDialog } from '@/features/editor/export/ExportDialog';
import { AgentActivityIndicator } from '@/features/editor/live';
import { TilemapEditor } from '@/features/editor/tilemap/TilemapEditor';
import { ToolPanel } from '@/features/editor/tools/ToolPanel';
import { useToastAnchor } from '@/hooks/useToastAnchor';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import {
  BRUSH_SHAPES,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  SHAPES,
  useEditorStore,
  type BrushShape,
  type Shape,
  type Tool,
} from '@/stores/useEditorStore';
import { useToastStore } from '@/stores/useToastStore';

/**
 * The editor: the sprite on the stage, its tool column beside it, and the dock
 * floating over the lot.
 *
 * There is no heading. The selected tab already says Editor, and a title
 * repeating it would cost a band of vertical space at the top of the one
 * screen that wants every pixel for the canvas.
 *
 * WHAT IS ON THE STAGE, AND HOW IT GOT THERE.
 *
 * The document the project tree has open: an asset in SQLite, composited from
 * its indexed layers by Rust. The screen is written against "the document that
 * is open" and not against who opened it, which is what lets an agent drawing
 * over MCP and a person drawing with a pencil arrive on the same stage by the
 * same route. A background asset is the one exception: it has no pixels of
 * its own to composite, only a grid of tile ids, so the stage shows
 * `TilemapEditor` instead of `DocumentCanvas` for it. `key={assetId}` is what
 * throws the tilemap editor's own state away when the open asset changes,
 * rather than leaving it showing the previous background's map for a beat.
 *
 * THE DOCK CHOOSES AND OPENS. IT DOES NOT ACT.
 *
 * The tool cluster, the brush that tool uses, and what the canvas draws over
 * the sprite. Everything in it opens a popover or moves a selection; nothing
 * in it acts on a single press. See the note in Dock.tsx for why that rule
 * exists. The one press that does act on this screen is Apply, in the tool
 * column, where it sits beside the settings it applies.
 *
 * The bell and the export button share the trailing rail. Export opens a
 * dialog rather than exporting on the spot, which keeps it on the "opens"
 * side of that same rule; it is disabled with nothing open, since there is
 * nothing yet to export. The bar between the rails is held on the window's
 * centre by the grid in Dock.tsx rather than by the space the rails leave
 * over, so a rail changing width cannot slide it.
 */
export function EditorScreen(): ReactElement {
  const { t } = useTranslation('editor');
  const { t: tCommon } = useTranslation();
  const { t: tExport } = useTranslation('export');

  const assetId = useDocumentStore((state) => state.assetId);
  const asset = useDocumentStore((state) => state.asset);
  const [exportOpen, setExportOpen] = useState(false);

  // Closed the moment the open asset changes, rather than carried over onto
  // whatever is open next. Without this, switching sprites while the dialog
  // is up would silently retarget it at the new asset instead of closing, or
  // leave it looking open for an asset nobody chose to export.
  useEffect(() => {
    setExportOpen(false);
  }, [assetId]);

  const tool = useEditorStore((state) => state.tool);
  const shape = useEditorStore((state) => state.shape);
  const brushSize = useEditorStore((state) => state.brushSize);
  const brushShape = useEditorStore((state) => state.brushShape);
  const showPixelGrid = useEditorStore((state) => state.showPixelGrid);
  const showCheckerboard = useEditorStore((state) => state.showCheckerboard);
  const setTool = useEditorStore((state) => state.setTool);
  const setShape = useEditorStore((state) => state.setShape);
  const setBrushSize = useEditorStore((state) => state.setBrushSize);
  const setBrushShape = useEditorStore((state) => state.setBrushShape);
  const setShowPixelGrid = useEditorStore((state) => state.setShowPixelGrid);
  const setShowCheckerboard = useEditorStore((state) => state.setShowCheckerboard);

  const unread = useToastStore((state) => state.unread);
  const markRead = useToastStore((state) => state.markRead);
  // Stable, and put on the bell and nowhere else: it measures the button and
  // publishes its centre, which is where a new toast grows out of.
  const anchor = useToastAnchor();

  // The count belongs in the name, not only in the badge. A badge reading "3"
  // is a shape with a number in it to anything that cannot see it.
  const bellLabel =
    unread > 0
      ? `${tCommon('notifications.label')}, ${tCommon('notifications.unread', { count: unread })}`
      : tCommon('notifications.label');

  // Built here rather than at module scope, because the labels are translated
  // and have to be read again when the language changes.
  const brushShapes: Record<BrushShape, string> = {
    circle: t('dock.brushCircle'),
    square: t('dock.brushSquare'),
  };

  const shapes: Record<Shape, { label: string; icon: ReactElement }> = {
    line: { label: t('dock.shapeLine'), icon: <ShapeLineIcon /> },
    curve: { label: t('dock.shapeCurve'), icon: <ShapeCurveIcon /> },
    rectangle: { label: t('dock.shapeRectangle'), icon: <ShapeRectangleIcon /> },
    ellipse: { label: t('dock.shapeEllipse'), icon: <ShapeEllipseIcon /> },
  };

  // The shape tool wears the shape it would draw, so the cluster says what the
  // next stroke lays down without anything being opened, and the flyout that
  // changes it hangs off that same chip. It used to be two controls sitting
  // side by side, a shape tool and a shape picker, which is one control too
  // many for one decision.
  const tools: readonly DockChoice<Tool>[] = [
    { value: 'pencil', label: t('dock.toolPencil'), icon: <PencilIcon /> },
    { value: 'eraser', label: t('dock.toolEraser'), icon: <EraserIcon /> },
    { value: 'fill', label: t('dock.toolFill'), icon: <FillIcon /> },
    {
      value: 'shape',
      label: shapes[shape].label,
      icon: shapes[shape].icon,
      popover: {
        label: t('dock.shapes'),
        // Two by two rather than a column of four: a column of shapes is a
        // list to read, a grid is a set to look at, and the four are picked by
        // their outline rather than by their name.
        render: (close: () => void) => (
          <div className="grid grid-cols-2 gap-2">
            {SHAPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-current={shape === option}
                onClick={() => {
                  setShape(option);
                  close();
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-sm border p-2',
                  'text-xs font-medium transition-colors',
                  shape === option
                    ? 'border-line bg-surface-content-alt text-fg-primary'
                    : 'border-transparent text-fg-secondary hover:bg-surface-content-alt hover:text-fg-primary',
                )}
              >
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">
                  {shapes[option].icon}
                </span>
                <span className="w-full truncate text-center">{shapes[option].label}</span>
              </button>
            ))}
          </div>
        ),
      },
    },
  ];

  return (
    <div className="flex h-full gap-4 p-4 pb-16">
      {/* One container, split into two columns. A square sprite centred in a
          wide content area leaves a column of dead space at each side at every
          window size, and this is what goes in it - inside the same frame, not
          in a panel of its own beside it. `min-h-0` is what lets the pair
          shrink rather than overflowing, since a flex item's automatic minimum
          is its content. */}
      <div className="flex min-h-0 flex-1 gap-3 rounded-lg border border-line-subtle bg-surface-content p-1 shadow-sm lg:pe-3">
        {assetId !== null && asset?.kind === 'background' ? (
          <TilemapEditor key={assetId} assetId={assetId} />
        ) : (
          <DocumentCanvas />
        )}
        {/* The second column: the palette, the layers and the step - what the
            sprite in front of you is made of, and what it is waiting for. */}
        <div className="hidden min-w-64 max-w-80 flex-1 flex-col ps-1 lg:flex">
          <ToolPanel />
        </div>
      </div>

      <Dock
        cluster={
          <DockChoices
            choices={tools}
            value={tool}
            label={t('dock.tools')}
            onValueChange={setTool}
          />
        }
        leadingRail={<AgentActivityIndicator />}
        trailingRail={
          <div className="flex items-center gap-1">
            <Tooltip label={tExport('open')}>
              <IconButton
                label={tExport('open')}
                disabled={assetId === null}
                onClick={() => {
                  setExportOpen(true);
                }}
              >
                <ExportIcon />
              </IconButton>
            </Tooltip>
            <DockPopover
              triggerLabel={bellLabel}
              label={tCommon('notifications.title')}
              align="end"
              width="w-80"
              padding="p-1"
              triggerRef={anchor}
              onOpen={markRead}
              panel={() => <NotificationList />}
            >
              <BellIcon />
              {unread > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -end-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center',
                    'rounded-full px-1 text-[10px] font-semibold leading-none',
                    // Inverted rather than accent. The accent already marks the
                    // chosen tool in this same row, and a second yellow thing
                    // stops reading as "look here" and starts reading as
                    // decoration. Inverting is the only thing in the bar that
                    // does it, so it stands out by being unlike the rest. The
                    // pair is --fg-primary against --surface-float with the
                    // roles swapped, so it carries that pair's ratio.
                    'bg-fg-primary text-surface-float',
                  )}
                >
                  {unread}
                </span>
              )}
            </DockPopover>
          </div>
        }
      >
        {/* THE BRUSH, BESIDE THE TOOL IT SIZES.

            Aseprite puts brush size and shape in a context bar directly above
            the sprite editor, Pixelorama in a tool options panel under the
            toolbox, Piskel in the tool row itself. The common factor is that
            all three sit next to the tool selector rather than in a general
            purpose panel: a size control is meaningless without knowing which
            tool it sizes.

            Both are read the moment a stroke begins and held for its whole
            length, so changing either mid-drag cannot alter a stroke that is
            already being made. */}
        <DockEntry label={t('dock.brush')} icon={<BrushIcon />}>
          {() => (
            <div className="flex flex-col gap-3">
              <NumberField
                label={t('dock.brushSize')}
                min={MIN_BRUSH_SIZE}
                max={MAX_BRUSH_SIZE}
                value={brushSize}
                onValueChange={setBrushSize}
              />

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-secondary">
                  {t('dock.brushShape')}
                </span>
                <div className="flex gap-2">
                  {BRUSH_SHAPES.map((option) => (
                    <Pill
                      key={option}
                      tone="anchor"
                      active={brushShape === option}
                      onClick={() => {
                        setBrushShape(option);
                      }}
                    >
                      {brushShapes[option]}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DockEntry>

        {/* WHAT THE CANVAS DRAWS, NOT WHAT IS IN THE SPRITE.

            Both of these change the view and nothing else. Neither touches the
            sprite or anything that is saved. Last in the bar, so the panel
            opens inwards rather than off the window's trailing edge at the
            smallest window size. */}
        <DockEntry label={t('dock.view')} icon={<GridIcon />} align="end">
          {() => (
            <div className="flex flex-col gap-3">
              <Toggle
                label={t('dock.pixelGrid')}
                hint={t('dock.pixelGridHint')}
                checked={showPixelGrid}
                onCheckedChange={setShowPixelGrid}
              />
              <Toggle
                label={t('dock.checkerboard')}
                hint={t('dock.checkerboardHint')}
                checked={showCheckerboard}
                onCheckedChange={setShowCheckerboard}
              />
            </div>
          )}
        </DockEntry>
      </Dock>

      {assetId !== null && exportOpen && (
        <ExportDialog
          key={assetId}
          assetId={assetId}
          open
          onClose={() => {
            setExportOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** The notification bell. */
function BellIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M4.1 6.9a3.9 3.9 0 0 1 7.8 0c0 2.2.5 3.2 1 4 .2.3 0 .7-.4.7H3.5c-.4 0-.6-.4-.4-.7.5-.8 1-1.8 1-4z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 13.3a1.8 1.8 0 0 0 3.2 0"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** An arrow leaving a tray, for writing the open asset out as a PNG. */
function ExportIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M8 2v7.4M5.2 6.4L8 9.2l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 10.6v1.4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The tool icons.
 *
 * The set is the one every pixel editor agrees on. Aseprite, Libresprite,
 * Piskel and Pixelorama all give their primary bar a pencil, an eraser and a
 * bucket fill, and Pixelorama's shape tools are exactly the four drawn here.
 * There is no marquee, because no op in the write path honours a region.
 *
 * Stroked outlines on a 16 unit grid, drawn in currentColor so they follow the
 * chip's text token through hover, focus, and the chosen state.
 */

/** Draws one pixel at a time. */
function PencilIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M3.3 12.7l.7-2.5 6.4-6.4 1.8 1.8-6.4 6.4-2.5.7z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9.2 4.6l1.8 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Clears the pixels it passes over. */
function EraserIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M6 13.2H3.6a1.1 1.1 0 0 1-.8-1.9l6.5-6.5a1.1 1.1 0 0 1 1.6 0l2.3 2.3a1.1 1.1 0 0 1 0 1.6l-4.5 4.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6.3 7.6l4.1 4.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Floods an area of one colour with another. */
function FillIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M8 2.4c2.3 2.8 3.5 4.7 3.5 6a3.5 3.5 0 0 1-7 0c0-1.3 1.2-3.2 3.5-6z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A bowed run between two points. */
function ShapeCurveIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M3.2 12.4C3.2 6 6.6 3.4 12.6 3.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="3.2" cy="12.4" r="1.3" fill="currentColor" />
      <circle cx="12.6" cy="3.6" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** A straight run between two points. */
function ShapeLineIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** A four sided outline. */
function ShapeRectangleIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <rect
        x="2.4"
        y="4"
        width="11.2"
        height="8"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** A round outline. */
function ShapeEllipseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <ellipse cx="8" cy="8" rx="5.6" ry="4.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * The popover icons.
 *
 * Stroked outlines on a 16 unit grid, drawn in currentColor so they follow the
 * entry's text token through hover, focus, and the open state without knowing
 * anything about the theme.
 */

/** A round tip on a handle, for the footprint a stroke lays down. */
function BrushIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M13.1 2.9c-1 1-4.3 3.2-5.6 4.1l1.5 1.5c.9-1.3 3.1-4.6 4.1-5.6z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 8.2a2.1 2.1 0 0 1 1.2 1.2c.4 1.2-.5 2.6-2.1 2.9-1.1.2-2.4 0-3.2-.3.8-.4 1-1 1.1-1.8.2-1.4 1.6-2.4 3-2z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Four cells, for the lines the canvas draws over the sprite. */
function GridIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.4v11.2M2.4 8h11.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
