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
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Dock,
  DockAction,
  DockChoices,
  DockEntry,
  DockPopover,
  type DockChoice,
} from '@/components/layout/Dock';
import { NotificationList } from '@/components/ui/NotificationList';
import { Button } from '@/components/ui/Button';
import { TextAreaField, Toggle } from '@/components/ui/Field';
import { NumberField } from '@/components/ui/NumberField';
import { Pill } from '@/components/ui/Pill';
import { ParameterPanel } from '@/features/generation/ParameterPanel';
import { SystemStatusFace, SystemStatusPanel } from '@/components/layout/SystemStatus';
import { PreviewRail } from '@/features/generation/PreviewRail';
import { SpriteCanvas } from '@/features/generation/SpriteCanvas';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useErrorMessage } from '@/hooks/useErrorMessage';
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
import { useGenerationStore } from '@/stores/useGenerationStore';
import { useToastStore } from '@/stores/useToastStore';
import { useToastAnchor } from '@/hooks/useToastAnchor';
import { cn } from '@/lib/cn';

/**
 * The generate screen: the stage and its rail on the left, parameters on the
 * right, the prompt underneath and the dock floating over the lot.
 *
 * There is no heading. The selected tab already says Generate, and a title
 * repeating it cost a band of vertical space at the top of the one screen that
 * wants every pixel for the canvas.
 *
 * THE DOCK HOLDS WHAT THE RIGHT PANEL DOES NOT, AND NOTHING ELSE.
 *
 * The right panel is the generation request: what to make. Size, steps,
 * guidance, seed, batch, model, style adapter and post-processing all live
 * there, in full. The dock used to carry a second copy of the size, the seed
 * and the post-processing, which bought nothing and cost a second place to
 * change one value; those are gone.
 *
 * What is left is the other half of the division: acting on the sprite in front
 * of you, and the canvas you are looking at. The tool cluster, the brush that
 * tool uses, and what the canvas draws over the sprite. Reset stays because it
 * belongs to neither the request nor the view and has no other home; it is the
 * one entry whose popover contains a press that acts, and that press is behind
 * a confirm.
 *
 * Everything in it opens a popover or moves a selection; only Generate acts on
 * its own press. See the note in Dock.tsx for why that rule exists.
 *
 * THE RUN PILL IS ON THE LEADING RAIL AND THE BELL IS ALONE ON THE TRAILING
 * ONE. The bar between them is held on the window's centre by the grid in
 * Dock.tsx rather than by the space the rails leave over, so moving a rail from
 * one side to the other cannot slide it.
 */
export function GenerateScreen(): ReactElement {
  const { t } = useTranslation('generation');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const request = useGenerationStore((state) => state.request);
  const patch = useGenerationStore((state) => state.patch);
  const reset = useGenerationStore((state) => state.reset);
  const run = useGenerationStore((state) => state.run);
  const running = useGenerationStore((state) => state.running);
  const images = useGenerationStore((state) => state.images);
  const error = useGenerationStore((state) => state.error);

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

  // Which sprite of the batch the stage is showing. Local rather than in a
  // store: it means nothing outside this screen and it does not survive a run.
  // It is clamped on read rather than reset on every new run, because a run
  // that returns fewer sprites than the last one is the only way it can go out
  // of range and clamping handles that without a subscription.
  const [chosen, setChosen] = useState(0);
  const selected = images.length === 0 ? 0 : Math.min(chosen, images.length - 1);

  const unread = useToastStore((state) => state.unread);
  const markRead = useToastStore((state) => state.markRead);
  // Stable, and put on the bell and nowhere else: it measures the button and
  // publishes its centre, which is where a new toast grows out of.
  const anchor = useToastAnchor();

  const { ready } = useCapabilities();
  const message = translateError(error);
  const canGenerate = ready && !running && request.prompt.trim() !== '';

  // The face carries the headline and the panel carries the rest. The
  // duration was on the face too until it was measured: the rail came out at
  // 192px, which does not fit beside the dock in a 960px window - the smallest
  // the window is allowed to be - once a Vietnamese label expands a chip.

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
    { value: 'select', label: t('dock.toolSelect'), icon: <SelectIcon /> },
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
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        {/* One container, split into two columns. A square sprite centred in a
            wide content area leaves a column of dead space at each side at
            every window size, and this is what goes in it - inside the same
            frame, not in a panel of its own beside it. `min-h-0` is what lets
            the pair shrink instead of pushing the prompt card off the bottom,
            since a flex item's automatic minimum is its content. */}
        <div className="flex min-h-0 flex-1 gap-3 rounded-lg border border-line-subtle bg-surface-content p-1 shadow-sm lg:pe-3">
          <SpriteCanvas
            image={images[selected]}
            showPixelGrid={showPixelGrid}
            showCheckerboard={showCheckerboard}
            requested={{ width: request.width, height: request.height }}
          />
          <PreviewRail images={images} selected={selected} onSelect={setChosen} />
        </div>

        {/* p-3 rather than p-4, and the failure line renders only when there is
            one. Both are the stage's height: the prompt card and the stage
            share a column, so every row this card reserves for something that
            is usually not there comes off the sprite. */}
        <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-line-subtle bg-surface-content p-3 shadow-sm">
          <TextAreaField
            label={t('prompt.label')}
            value={request.prompt}
            placeholder={t('prompt.placeholder')}
            onValueChange={(value) => {
              patch({ prompt: value });
            }}
          />
          <TextAreaField
            label={t('prompt.negativeLabel')}
            value={request.negativePrompt}
            placeholder={t('prompt.negativePlaceholder')}
            rows={2}
            onValueChange={(value) => {
              patch({ negativePrompt: value });
            }}
          />

          {/* Only the failure reason. What a run produced is stated by the run
              pill in the dock, and a figure in two places is a figure that
              disagrees with itself the first time one of them is missed. */}
          {message !== null && <p className="text-xs text-fg-secondary">{message}</p>}
        </div>
      </section>

      <ParameterPanel />

      <Dock
        cluster={
          <DockChoices
            choices={tools}
            value={tool}
            label={t('dock.tools')}
            onValueChange={setTool}
          />
        }
        leadingRail={
          /* What this machine can run. Every fact in here already existed in a
             store and none of it was on screen, so an application with a
             working GPU in front of it reported nothing at all, and the
             missing piece was only discoverable from a log.
             Aligned to the start: it sits at the window's leading edge, and a
             centred panel would hang half of itself off the screen. */
          <DockPopover
            variant="pill"
            label={t('binaries.title')}
            align="start"
            width="w-72"
            panel={() => <SystemStatusPanel />}
          >
            <SystemStatusFace />
          </DockPopover>
        }
        trailingRail={
          /* The bell, alone. Everything that used to sit beside it has moved
             to the leading rail. The panel is the shared notification list,
             which draws no surface of its own and expects to sit in one of
             ours. */
          <DockPopover
            triggerLabel={bellLabel}
            label={tCommon('notifications.title')}
            align="end"
            width="w-auto"
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
                  // chosen tool and the Generate pill in this same row, and a
                  // third yellow thing stops reading as "look here" and starts
                  // reading as decoration. Inverting is the only thing in the
                  // bar that does it, so it stands out by being unlike the
                  // rest. The pair is --fg-primary against --surface-float
                  // with the roles swapped, so it carries that pair's ratio.
                  'bg-fg-primary text-surface-float',
                )}
              >
                {unread}
              </span>
            )}
          </DockPopover>
        }
        action={
          <DockAction
            disabled={!canGenerate}
            onClick={() => {
              void run();
            }}
          >
            {running ? t('actions.generating') : t('actions.generate')}
          </DockAction>
        }
      >
        {/* THE BRUSH, BESIDE THE TOOL IT SIZES.

            Aseprite puts brush size and shape in a context bar directly above
            the sprite editor, Pixelorama in a tool options panel under the
            toolbox, Piskel in the tool row itself. The common factor is that
            all three sit next to the tool selector rather than in a general
            purpose panel: a size control is meaningless without knowing which
            tool it sizes.

            Nothing consumes these yet, because there is no painting surface.
            That is the standing the tool selector beside it has had since it
            was built, and it is honest for the same reason - choosing says
            what a stroke would do, and no stroke is being claimed. */}
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

        {/* WHAT THE CANVAS DRAWS, NOT WHAT THE ENGINE MAKES.

            Both of these change the view and nothing else. Neither touches the
            request, the sprite, or anything that is saved. The request's own
            `postprocess.pixelGrid` is a different thing entirely - a block size
            the engine resamples the sprite onto, which produces a different
            image - and it is named "Snap to Grid" in the parameter panel so
            that the two are never read as the same control. */}
        <DockEntry label={t('dock.view')} icon={<GridIcon />}>
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

        {/* Last in the bar, so its panel opens inwards rather than off the
            window's trailing edge at the smallest window size. */}
        <DockEntry label={t('actions.reset')} icon={<ResetIcon />} align="end">
          {(close) => (
            <div className="flex flex-col gap-3">
              {/* What it destroys, stated before the button that destroys it.
                  This is information the user has to act on, so it is
                  secondary text and not muted. */}
              <p className="text-sm text-fg-secondary">{t('dock.resetWarning')}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>
                  {t('dock.resetCancel')}
                </Button>
                <Button
                  onClick={() => {
                    reset();
                    close();
                  }}
                >
                  {t('dock.resetConfirm')}
                </Button>
              </div>
            </div>
          )}
        </DockEntry>
      </Dock>
    </div>
  );
}

export interface RunRowProps {
  /** What the figure is. Always a translated string. */
  label: string;
  /** The figure. */
  value: string;
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

/**
 * The tool icons.
 *
 * The set is the one every pixel editor agrees on. Aseprite, Libresprite,
 * Piskel and Pixelorama all give their primary bar a pencil, an eraser, a
 * bucket fill and a rectangular selection, and Pixelorama's shape tools are
 * exactly the four drawn here.
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

/** Marks out a region for whatever comes next. */
function SelectIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <rect
        x="2.6"
        y="2.6"
        width="10.8"
        height="10.8"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2.6 2"
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

/** An arrow coming back round to where it started. */
function ResetIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M11.9 1.7v2.6H9.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
