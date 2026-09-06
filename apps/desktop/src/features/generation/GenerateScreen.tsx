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
import { Field, TextAreaField, Toggle } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { ParameterPanel } from '@/features/generation/ParameterPanel';
import { SpriteCanvas } from '@/features/generation/SpriteCanvas';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { SHAPES, useEditorStore, type Shape, type Tool } from '@/stores/useEditorStore';
import { useGenerationStore } from '@/stores/useGenerationStore';
import { useToastStore } from '@/stores/useToastStore';
import { useToastAnchor } from '@/hooks/useToastAnchor';
import { cn } from '@/lib/cn';

const MAX_SEED = 2 ** 31 - 1;

/**
 * The sprite sizes worth reaching in one press.
 *
 * Powers of two, and square, because that is what a tile sheet and an atlas
 * packer both want. Anything else is typed into the two fields beneath them,
 * or into the parameter panel, which remains the full surface.
 */
const SIZE_PRESETS: readonly { readonly width: number; readonly height: number }[] = [
  { width: 16, height: 16 },
  { width: 32, height: 32 },
  { width: 64, height: 64 },
  { width: 128, height: 128 },
];

/**
 * The generate screen: prompt and canvas on the left, parameters on the right.
 *
 * There is no heading. The selected tab already says Generate, and a title
 * repeating it cost a band of vertical space at the top of the one screen that
 * wants every pixel for the canvas.
 *
 * The dock along the bottom is shortcuts, not a second parameter panel. It
 * carries the three things reached most often between one run and the next -
 * the size, the seed, and the post-processing - plus reset, behind a confirm.
 * Everything in it opens a popover; only Generate acts on its own press. See
 * the note in Dock.tsx for why that rule exists.
 */
export function GenerateScreen(): ReactElement {
  const { t } = useTranslation('generation');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const request = useGenerationStore((state) => state.request);
  const patch = useGenerationStore((state) => state.patch);
  const patchPostprocess = useGenerationStore((state) => state.patchPostprocess);
  const reset = useGenerationStore((state) => state.reset);
  const run = useGenerationStore((state) => state.run);
  const running = useGenerationStore((state) => state.running);
  const images = useGenerationStore((state) => state.images);
  const durationMs = useGenerationStore((state) => state.durationMs);
  const error = useGenerationStore((state) => state.error);

  const tool = useEditorStore((state) => state.tool);
  const shape = useEditorStore((state) => state.shape);
  const setTool = useEditorStore((state) => state.setTool);
  const setShape = useEditorStore((state) => state.setShape);

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
  //
  // Read from the sprites that came out rather than from the parameters that
  // are entered now. The two stop agreeing the moment the user changes a field
  // after a run, and post-processing can resize the output anyway, so the
  // request is the wrong place to ask what the last run produced.
  const produced = images[0];
  const runFace = running
    ? t('actions.generating')
    : produced === undefined
      ? t('dock.runNone')
      : t('result.count', { count: images.length });

  // The count belongs in the name, not only in the badge. A badge reading "3"
  // is a shape with a number in it to anything that cannot see it.
  const bellLabel =
    unread > 0
      ? `${tCommon('notifications.label')}, ${tCommon('notifications.unread', { count: unread })}`
      : tCommon('notifications.label');

  // Built here rather than at module scope, because the labels are translated
  // and have to be read again when the language changes.
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
        <SpriteCanvas images={images} />

        <div className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-content p-4 shadow-sm">
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
          <p className="min-h-4 text-xs text-fg-secondary">
            {message !== null && <span>{message}</span>}
          </p>
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
        trailingRail={
          <>
            {/* States what the last run produced, and opens the detail. The
                figures come from the run, so pressing it can only ever show
                more of what the face already says. */}
            <DockPopover
              variant="pill"
              label={t('dock.lastRun')}
              align="end"
              width="w-56"
              panel={() =>
                produced === undefined ? (
                  <p className="text-sm text-fg-secondary">{t('dock.runNone')}</p>
                ) : (
                  <dl className="flex flex-col gap-2">
                    <RunRow
                      label={t('parameters.size')}
                      value={t('dock.dimensions', {
                        width: produced.width,
                        height: produced.height,
                      })}
                    />
                    <RunRow
                      label={t('dock.runDuration')}
                      value={`${String(durationMs)} ${tCommon('units.milliseconds')}`}
                    />
                  </dl>
                )
              }
            >
              <span className="tabular-nums">{runFace}</span>
            </DockPopover>

            {/* The panel is the shared notification list, which draws no
                surface of its own and expects to sit in one of ours. */}
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
          </>
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
        <DockEntry label={t('parameters.size')} icon={<SizeIcon />}>
          {() => (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {SIZE_PRESETS.map((preset) => (
                  <Pill
                    key={`${preset.width}x${preset.height}`}
                    tone="anchor"
                    active={request.width === preset.width && request.height === preset.height}
                    onClick={() => {
                      patch({ width: preset.width, height: preset.height });
                    }}
                  >
                    {t('dock.dimensions', { width: preset.width, height: preset.height })}
                  </Pill>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t('parameters.width')}
                  type="number"
                  min={8}
                  max={2048}
                  value={request.width}
                  onChange={(event) => {
                    patch({ width: Number(event.target.value) });
                  }}
                />
                <Field
                  label={t('parameters.height')}
                  type="number"
                  min={8}
                  max={2048}
                  value={request.height}
                  onChange={(event) => {
                    patch({ height: Number(event.target.value) });
                  }}
                />
              </div>
            </div>
          )}
        </DockEntry>

        <DockEntry label={t('parameters.seed')} icon={<SeedIcon />}>
          {() => (
            <div className="flex flex-col gap-3">
              <Field
                label={t('parameters.seed')}
                type="number"
                min={0}
                placeholder={t('parameters.seedRandom')}
                hint={t('dock.seedHint')}
                value={request.seed ?? ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  patch({ seed: raw === '' ? null : Number(raw) });
                }}
              />

              {/* Randomising overwrites whatever the user typed, which is why
                  it lives in here. In the bar it was one stray press away at
                  all times. */}
              <Button
                onClick={() => {
                  patch({ seed: Math.floor(Math.random() * MAX_SEED) });
                }}
              >
                {t('dock.seedRandomise')}
              </Button>
            </div>
          )}
        </DockEntry>

        <DockEntry label={t('postprocess.title')} icon={<PostprocessIcon />}>
          {() => (
            <div className="flex flex-col gap-3">
              <Toggle
                label={t('postprocess.removeBackground')}
                checked={request.postprocess.removeBackground}
                onCheckedChange={(checked) => {
                  patchPostprocess({ removeBackground: checked });
                }}
              />
              <Toggle
                label={t('postprocess.dither')}
                checked={request.postprocess.dither}
                onCheckedChange={(checked) => {
                  patchPostprocess({ dither: checked });
                }}
              />
              <Field
                label={t('postprocess.paletteSize')}
                type="number"
                min={2}
                max={256}
                value={request.postprocess.paletteSize ?? ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  patchPostprocess({ paletteSize: raw === '' ? null : Number(raw) });
                }}
              />
              <Field
                label={t('postprocess.pixelGrid')}
                type="number"
                min={1}
                max={64}
                value={request.postprocess.pixelGrid ?? ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  patchPostprocess({ pixelGrid: raw === '' ? null : Number(raw) });
                }}
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

/** One line of the run detail: what it is, and what it was. */
function RunRow({ label, value }: RunRowProps): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd className="text-sm tabular-nums text-fg-primary">{value}</dd>
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

/** A frame with its corners drawn in, for the sprite's dimensions. */
function SizeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.6 9.4V6.6h2.8M10.4 6.6v2.8H7.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A die, for the number a run is rolled from. */
function SeedIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.6" cy="5.6" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="10.4" cy="10.4" r="1" fill="currentColor" />
    </svg>
  );
}

/** Two sliders, for the passes run over a finished sprite. */
function PostprocessIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path d="M2.5 5h11M2.5 11h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="5" r="1.9" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.5" cy="11" r="1.9" stroke="currentColor" strokeWidth="1.4" />
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
