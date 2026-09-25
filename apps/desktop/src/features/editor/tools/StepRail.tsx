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
 * The steps strip: where the sprite is in the workflow, what the step expects,
 * and what the gates measured, laid out where the reference studio layout has
 * its animation timeline.
 *
 * A GATE IS MEASURED, NEVER ASSERTED. Every check in the report was computed
 * from the pixel buffer in Rust, and both halves of it are shown: the ones that
 * failed, with what was measured and what to do about it, and the ones that
 * passed, so a reader can tell a gate that verified the work from one that
 * never looked. The bar carries both counts for the same reason, and the full
 * report is one press away in a popover rather than reduced to a count,
 * because a count cannot say which three pixels are stray.
 *
 * `detail` AND `hint` ARE NOT TRANSLATED, and that is deliberate rather than an
 * omission. They are assembled in Rust beside the measurement that produced
 * them, which is the only place that knows the coordinates of the three stray
 * pixels or the size of the region that reads flat. A reason code chosen here
 * instead would have to throw those away, and a hint with the coordinates
 * removed is not a hint. The check's `name`, the step's name and everything
 * this component says in its own voice do go through the locale files.
 *
 * THE STRIP OFFERS BOTH WAYS THROUGH A GATE THAT DOES NOT PASS. The card of
 * every step already done is a button that opens a confirmation and, on
 * Revisit, calls `revisit(step)`; the bar's Revisit does the same for the step
 * just before this one. Going back moves nothing but the current step, so
 * every layer painted since stays exactly as it was, which the confirmation
 * says in full rather than asking "are you sure?" of a reader who does not yet
 * know what is at stake. The card of a step still ahead is not a button,
 * because `step_revisit` only ever moves backward and pressing it on a step not
 * yet reached would either fail or lie. Separately, while the gate has not
 * passed and the step is not the last one, the bar offers to advance anyway; it
 * also confirms first, naming the checks that failed, because
 * `step_advance(true)` is recorded as forced and a person should know that
 * before they choose it, not discover it later reading the sprite's history.
 *
 * EACH CARD SHOWS THE PIXELS ITS STEP OWNS, composited here from the buffers
 * and the palette the document store already holds. They are the same bytes
 * the canvas draws, so a thumbnail cannot show work the document does not
 * have; the four steps that own no layer show what they work on instead.
 */

import {
  Check as CheckIcon,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Layers as LayersIcon,
  Lock,
  Palette as PaletteIcon,
  Play,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/Dialog';
import { useWorkflowLabels } from '@/features/editor/labels';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import {
  STEP_ROLES,
  STEPS,
  type GateCheck,
  type Layer,
  type Palette,
  type Step,
} from '@/types/document';

/** The reason codes a refused advance comes back with. */
const STEP_CODE = 'step.';

/**
 * What a step that paints no layer shows in place of a thumbnail: the thing it
 * works on, since it has no pixels of its own to show.
 */
const STEP_ICONS: Partial<Record<Step, LucideIcon>> = {
  reference: ImageIcon,
  palette: PaletteIcon,
  cleanup: Sparkles,
  variation: Copy,
};

/** The quiet buttons in the bar: Check, Revisit and Force advance. */
const BAR_BUTTON =
  'flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:pointer-events-none disabled:opacity-50';

/** Every card's frame; the state adds its border, fill and ring. */
const CARD = 'group relative flex flex-shrink-0 flex-col items-center rounded border p-1';

/**
 * The steps strip.
 *
 * Fills the full width of the region it is mounted in, at a fixed `h-40`.
 *
 * @returns The current step and its gate in a bar, and one card per step.
 */
export function StepRail(): ReactElement {
  const { t } = useTranslation('editor');
  const { t: tw } = useTranslation('workflow');
  const labels = useWorkflowLabels();
  const translateError = useErrorMessage();

  const step = useDocumentStore((state) => state.step);
  const gate = useDocumentStore((state) => state.gate);
  const loading = useDocumentStore((state) => state.loading);
  const error = useDocumentStore((state) => state.error);
  const layers = useDocumentStore((state) => state.layers);
  const palette = useDocumentStore((state) => state.palette);
  const check = useDocumentStore((state) => state.check);
  const advance = useDocumentStore((state) => state.advance);
  const revisit = useDocumentStore((state) => state.revisit);

  const [revisitTarget, setRevisitTarget] = useState<Step | null>(null);
  const [forcing, setForcing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // The anchor holds the summary button as well as the popover, so pressing
  // the button to close the report is not also a press outside it that closes
  // it and then reopens it on the click.
  const reportAnchor = useRef<HTMLDivElement>(null);
  const reportId = useId();
  const closeReport = useCallback(() => {
    setReportOpen(false);
  }, []);
  useDismiss(reportOpen, reportAnchor, closeReport);

  if (step === null) {
    return (
      <section className="flex h-40 w-full shrink-0 flex-col border-t border-neutral-800 bg-neutral-950">
        <div className="flex h-10 items-center justify-between border-b border-neutral-800/80 bg-neutral-900/50 px-3 text-xs">
          <p className="text-[11px] text-neutral-400">{t('step.noDocument')}</p>
        </div>
      </section>
    );
  }

  const position = STEPS.indexOf(step.step);
  const failed = gate === null ? [] : gate.checks.filter((entry) => !entry.pass);
  const passed = gate === null ? [] : gate.checks.filter((entry) => entry.pass);
  const refusal = error !== null && error.startsWith(STEP_CODE) ? translateError(error) : null;
  const isLastStep = position === STEPS.length - 1;
  // Only a gate that ran and failed can be forced past. With no report yet (as
  // right after a revisit) there is nothing to override, so nothing is offered.
  const gateFailed = gate !== null && !gate.pass;
  const offerForce = gateFailed && !isLastStep;
  const previous = position > 0 ? STEPS[position - 1] : undefined;
  const roles = STEP_ROLES[step.step];
  const layerName =
    roles.length === 0 ? tw('noLayer') : roles.map((role) => labels.layer[role]).join(' + ');

  return (
    <section className="flex h-40 w-full shrink-0 flex-col border-t border-neutral-800 bg-neutral-950">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-neutral-800/80 bg-neutral-900/50 px-3 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <p
            className="flex items-baseline gap-1.5 whitespace-nowrap"
            title={expects(step.step, t)}
          >
            <span className="text-[11px] text-neutral-400">{tw('currentStep')}</span>
            <span className="font-medium text-pink-400">{labels.step[step.step]}</span>
            <span className="text-[11px] tabular-nums text-neutral-500">
              {t('step.position', { position: position + 1, of: STEPS.length })}
            </span>
          </p>

          <div ref={reportAnchor} className="relative border-l border-neutral-800 pl-3">
            <button
              type="button"
              className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-neutral-800"
              aria-haspopup="true"
              aria-expanded={reportOpen}
              aria-controls={reportOpen ? reportId : undefined}
              aria-label={
                gate === null
                  ? tw('gateNotChecked')
                  : tw('gateSummary', { passed: passed.length, failed: failed.length })
              }
              onClick={() => {
                setReportOpen((value) => !value);
              }}
            >
              {gate === null ? (
                <span className="text-[11px] text-neutral-500">{tw('notChecked')}</span>
              ) : (
                <>
                  <span className="flex items-center gap-1 tabular-nums text-emerald-400">
                    <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                    {passed.length}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums text-red-400">
                    <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                    {failed.length}
                  </span>
                </>
              )}
            </button>

            {reportOpen && (
              <div
                id={reportId}
                role="region"
                aria-label={tw('gateReport')}
                className="absolute bottom-full left-0 z-40 mb-2 flex max-h-72 w-80 flex-col gap-2 overflow-y-auto rounded border border-neutral-800 bg-neutral-950/90 p-3 shadow-md backdrop-blur"
              >
                {/* What the step expects, before the report about whether it
                    got it. The gate's own prose says what is wrong; this says
                    what was asked for, which is the thing a reader needs first
                    and the thing Rust never sends. */}
                <p className="text-[11px] text-neutral-400">{expects(step.step, t)}</p>
                {gate === null ? (
                  <p className="text-[11px] text-neutral-400">{t('step.noReport')}</p>
                ) : (
                  <>
                    <p
                      className={cn(
                        'text-[11px] font-medium',
                        gate.pass ? 'text-emerald-400' : 'text-red-400',
                      )}
                    >
                      {gate.pass
                        ? t('step.gatePassed', { count: passed.length })
                        : t('step.gateFailed', { count: failed.length })}
                    </p>
                    {failed.map((entry) => (
                      <Check key={entry.name} check={entry} failing />
                    ))}
                    {passed.map((entry) => (
                      <Check key={entry.name} check={entry} failing={false} />
                    ))}
                    {gate.checks.length === 0 && (
                      // A step with nothing to measure is not a step that
                      // passed by luck, and saying so is what stops an empty
                      // green line from reading as a verdict about the pixels.
                      <p className="text-[11px] text-neutral-400">{t('step.noChecks')}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <p className="flex min-w-0 items-center gap-1 text-[11px] text-purple-400">
            <LayersIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tw('stepLayer', { layer: layerName })}</span>
          </p>

          {refusal !== null && (
            <p
              role="alert"
              title={refusal}
              className="flex min-w-0 items-center gap-1 text-[11px] text-red-400"
            >
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{refusal}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={BAR_BUTTON}
            disabled={loading}
            onClick={() => {
              void check();
            }}
          >
            {t('step.check')}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded border border-pink-500 bg-pink-600 px-2 py-1 text-[11px] font-medium text-white shadow-sm shadow-pink-600/30 hover:bg-pink-500 disabled:pointer-events-none disabled:opacity-50"
            // Disabled from `canAdvance`, which Rust computes as the gate passing
            // and the step not being the last one. Guessing it here from the
            // report alone would offer an advance off the end of the workflow.
            disabled={loading || !step.canAdvance}
            onClick={() => {
              void advance();
            }}
          >
            <Play aria-hidden="true" className="h-3 w-3 fill-current" />
            {t('step.advance')}
          </button>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-neutral-800" />
          <button
            type="button"
            className={BAR_BUTTON}
            disabled={loading || previous === undefined}
            // Named after the step it goes back to, so it is never mistaken
            // for the confirmation's own Revisit, and a reader knows where it
            // leads before pressing it.
            aria-label={
              previous === undefined
                ? tw('revisitConfirm')
                : tw('revisitPrevious', { step: labels.step[previous] })
            }
            onClick={() => {
              if (previous !== undefined) {
                setRevisitTarget(previous);
              }
            }}
          >
            <RotateCcw aria-hidden="true" className="h-3 w-3" />
            {tw('revisitConfirm')}
          </button>
          {offerForce && (
            <button
              type="button"
              className={BAR_BUTTON}
              disabled={loading}
              onClick={() => {
                setForcing(true);
              }}
            >
              {tw('forceAdvance')}
            </button>
          )}
        </div>
      </div>

      <ol
        aria-label={tw('stepsLabel')}
        className="flex flex-1 items-center space-x-2.5 overflow-x-auto p-3"
      >
        {STEPS.map((entry, index) => {
          const state = index < position ? 'done' : index === position ? 'current' : 'ahead';
          const label = labels.step[entry];
          const content = (
            <StepCardContent
              number={index + 1}
              step={entry}
              label={label}
              state={state}
              layers={layers}
              palette={palette}
            />
          );
          return (
            <li key={entry} className="flex-shrink-0">
              {state === 'done' ? (
                <button
                  type="button"
                  className={cn(
                    CARD,
                    'border-neutral-800 bg-neutral-900/60 hover:border-neutral-700 hover:bg-neutral-900',
                  )}
                  aria-label={tw('revisitStep', { step: label })}
                  onClick={() => {
                    setRevisitTarget(entry);
                  }}
                >
                  {content}
                </button>
              ) : (
                <div
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    CARD,
                    state === 'current'
                      ? 'border-pink-500 bg-neutral-900 shadow-md shadow-pink-500/10 ring-1 ring-pink-500'
                      : 'border-neutral-800 bg-neutral-900/60 opacity-60',
                  )}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <Dialog
        open={revisitTarget !== null}
        title={tw('revisitTitle')}
        confirmLabel={tw('revisitConfirm')}
        onDismiss={() => {
          setRevisitTarget(null);
        }}
        onConfirm={() => {
          if (revisitTarget !== null) {
            void revisit(revisitTarget);
          }
          setRevisitTarget(null);
        }}
      >
        <p className="text-xs text-fg-secondary">{tw('revisitBody')}</p>
      </Dialog>

      <Dialog
        open={forcing}
        title={tw('forceAdvanceTitle')}
        confirmLabel={tw('forceAdvanceConfirm')}
        onDismiss={() => {
          setForcing(false);
        }}
        onConfirm={() => {
          void advance({ force: true });
          setForcing(false);
        }}
      >
        {forcing && (
          <>
            <p className="text-xs text-fg-secondary">{tw('forceAdvanceBody')}</p>
            <ul className="list-disc ps-4 text-xs text-fg-primary">
              {failed.map((entry) => (
                <li key={entry.name} className="font-mono">
                  {entry.name}
                </li>
              ))}
            </ul>
            <p className="text-xs text-fg-secondary">{tw('forceAdvanceNote')}</p>
          </>
        )}
      </Dialog>
    </section>
  );
}

interface StepCardContentProps {
  number: number;
  step: Step;
  label: string;
  state: 'done' | 'current' | 'ahead';
  layers: readonly Layer[];
  palette: Palette | null;
}

/**
 * What a step's card holds: its number and name, its thumbnail, and a badge.
 *
 * The name is an element of its own so that it reads as the step's name alone,
 * the word the rest of the interface uses; the number is decoration that a
 * screen reader already has from the list's order.
 *
 * @param props - The step, where it sits against the current one, and the
 *   document to draw its thumbnail from.
 * @returns The card's contents.
 */
function StepCardContent({
  number,
  step,
  label,
  state,
  layers,
  palette,
}: StepCardContentProps): ReactElement {
  const { t: tw } = useTranslation('workflow');
  const Icon = STEP_ICONS[step];
  return (
    <>
      <span className="mb-1 flex items-baseline gap-1 whitespace-nowrap text-[10px]">
        <span aria-hidden="true" className="tabular-nums text-neutral-500">
          {tw('stepNumber', { number })}
        </span>
        <span className={state === 'current' ? 'font-medium text-pink-400' : 'text-neutral-300'}>
          {label}
        </span>
      </span>
      <span className="checkerboard-pattern flex h-16 w-16 items-center justify-center rounded border border-neutral-800 bg-neutral-950 p-1">
        {Icon === undefined ? (
          <StepThumbnail step={step} layers={layers} palette={palette} />
        ) : (
          <Icon
            aria-hidden="true"
            data-testid={`step-icon-${step}`}
            className="h-6 w-6 text-neutral-500"
          />
        )}
      </span>
      {state === 'done' && (
        <span
          title={tw('stepDone')}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-neutral-950"
        >
          <CheckIcon aria-hidden="true" className="h-3 w-3" />
        </span>
      )}
      {state === 'ahead' && (
        <span
          title={tw('stepLocked')}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-neutral-400"
        >
          <Lock aria-hidden="true" className="h-2.5 w-2.5" />
        </span>
      )}
    </>
  );
}

interface StepThumbnailProps {
  step: Step;
  layers: readonly Layer[];
  palette: Palette | null;
}

/**
 * The pixels one step owns, composited in layer order over transparency.
 *
 * Drawn from `ImageData` rather than with a fill colour, so the sprite's own
 * bytes reach the canvas without ever being written out as a colour string:
 * they are the sprite, not a piece of the interface. A step whose layers do not
 * exist yet draws nothing, which is the truth about a step not reached.
 *
 * @param props - The step and the document's layers and palette.
 * @returns The thumbnail canvas, or nothing when the step has no pixels.
 */
function StepThumbnail({ step, layers, palette }: StepThumbnailProps): ReactElement | null {
  const image = useMemo(() => composite(step, layers, palette), [step, layers, palette]);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || image === null) {
      return;
    }
    element.width = image.width;
    element.height = image.height;
    const context = element.getContext('2d');
    if (context === null) {
      return;
    }
    context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);

  if (image === null) {
    return null;
  }
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-testid={`step-thumbnail-${step}`}
      className="pixelated h-full w-full object-contain"
    />
  );
}

/**
 * Composites a step's layers into straight sRGB bytes.
 *
 * A later layer covers an earlier one wherever it has a pixel, which is the
 * order `layers` already holds them in. An index the palette does not have is
 * left transparent rather than guessed at.
 *
 * @param step - The step whose layers to draw.
 * @param layers - Every layer of the document, sorted by ordinal.
 * @param palette - The document's palette.
 * @returns The image, or null when the step has no layer yet.
 */
function composite(
  step: Step,
  layers: readonly Layer[],
  palette: Palette | null,
): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null {
  const roles = STEP_ROLES[step];
  const own = layers.filter((layer) => roles.includes(layer.role));
  const first = own[0];
  if (first === undefined) {
    return null;
  }
  const { width, height } = first.buffer;
  if (width === 0 || height === 0) {
    return null;
  }
  const colours = new Map<number, readonly number[]>();
  for (const slot of palette?.slots ?? []) {
    colours.set(slot.index, slot.rgba);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (const layer of own) {
    // A buffer at another size cannot be laid over this one pixel for pixel.
    // It cannot happen while Rust sizes every layer to the asset.
    if (layer.buffer.width !== width || layer.buffer.height !== height) {
      continue;
    }
    layer.buffer.data.forEach((index, pixel) => {
      const rgba = index === 0 ? undefined : colours.get(index);
      if (rgba !== undefined) {
        data.set(rgba, pixel * 4);
      }
    });
  }
  return { width, height, data };
}

interface CheckProps {
  check: GateCheck;
  failing: boolean;
}

/**
 * One check from the report.
 *
 * A failing check shows its measurement and its hint; a passing one shows its
 * name and its measurement and no hint, because Rust drops the hint on a pass -
 * advice about a check that passed is advice about nothing.
 *
 * @param props - The check, and whether it failed.
 * @returns The row.
 */
function Check({ check, failing }: CheckProps): ReactElement {
  const { t } = useTranslation('editor');
  return (
    <div
      className={cn(
        'rounded-sm border-s-2 ps-2 text-[11px]',
        failing ? 'border-s-red-500' : 'border-s-emerald-500',
      )}
    >
      <p className="font-medium text-neutral-100">
        {/* The check's own stable name, shown as it is. It is the word that
            appears in the MCP report an agent reads and in this strip, and
            translating it would leave the two unable to refer to the same
            check. */}
        <span className="font-mono">{check.name}</span>
        <span className="ms-1 font-normal text-neutral-500">
          {failing ? t('step.checkFailed') : t('step.checkVerified')}
        </span>
      </p>
      {check.detail !== undefined && <p className="text-neutral-400">{check.detail}</p>}
      {check.hint !== undefined && <p className="text-neutral-200">{check.hint}</p>}
    </div>
  );
}

/**
 * What a step expects before it will let the sprite move on.
 *
 * Spelled out key by key rather than composed, for the reason given in
 * `features/editor/labels.ts`: a template key is a string at compile time and
 * a step renamed in the union would keep compiling and start showing a raw key.
 *
 * @param step - The current step.
 * @param t - The editor namespace's translator.
 * @returns One sentence.
 */
function expects(
  step: (typeof STEPS)[number],
  t: (key: `stepExpects.${(typeof STEPS)[number]}`) => string,
): string {
  switch (step) {
    case 'reference':
      return t('stepExpects.reference');
    case 'palette':
      return t('stepExpects.palette');
    case 'silhouette':
      return t('stepExpects.silhouette');
    case 'flats':
      return t('stepExpects.flats');
    case 'shadow':
      return t('stepExpects.shadow');
    case 'light':
      return t('stepExpects.light');
    case 'outline':
      return t('stepExpects.outline');
    case 'detail':
      return t('stepExpects.detail');
    case 'accent':
      return t('stepExpects.accent');
    case 'cleanup':
      return t('stepExpects.cleanup');
    case 'variation':
      return t('stepExpects.variation');
  }
}
