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
 * Where the sprite is in the workflow, what the step expects, and what the
 * gates measured.
 *
 * A GATE IS MEASURED, NEVER ASSERTED. Every check in the report was computed
 * from the pixel buffer in Rust, and both halves of it are shown: the ones that
 * failed, with what was measured and what to do about it, and the ones that
 * passed, so a reader can tell a gate that verified the work from one that
 * never looked. A rail showing only failures says nothing at all when the work
 * is clean, which is the moment the artist most wants to know it was checked.
 *
 * `detail` AND `hint` ARE NOT TRANSLATED, and that is deliberate rather than an
 * omission. They are assembled in Rust beside the measurement that produced
 * them, which is the only place that knows the coordinates of the three stray
 * pixels or the size of the region that reads flat. A reason code chosen here
 * instead would have to throw those away, and a hint with the coordinates
 * removed is not a hint. The check's `name`, the step's name and everything
 * this component says in its own voice do go through the locale files.
 *
 * THE RAIL OFFERS BOTH WAYS THROUGH A GATE THAT DOES NOT PASS. Every step
 * already done is a button that opens a confirmation and, on Revisit, calls
 * `revisit(step)`; going back moves nothing but the current step, so every
 * layer painted since stays exactly as it was, which the confirmation says in
 * full rather than asking "are you sure?" of a reader who does not yet know
 * what is at stake. A step still ahead is not a button, because `step_revisit`
 * only ever moves backward and pressing it on a step not yet reached would
 * either fail or lie. Separately, while the gate has not passed and the step
 * is not the last one, a second button offers to advance anyway; it also
 * confirms first, naming the checks that failed, because `step_advance(true)`
 * is recorded as forced and a person should know that before they choose it,
 * not discover it later reading the sprite's history.
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useWorkflowLabels } from '@/features/editor/labels';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { STEPS, type GateCheck, type Step } from '@/types/document';

/** The reason codes a refused advance comes back with. */
const STEP_CODE = 'step.';

/**
 * The step rail.
 *
 * @returns The current step, what it expects, and the gate report.
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
  const check = useDocumentStore((state) => state.check);
  const advance = useDocumentStore((state) => state.advance);
  const revisit = useDocumentStore((state) => state.revisit);

  const [revisitTarget, setRevisitTarget] = useState<Step | null>(null);
  const [forcing, setForcing] = useState(false);

  if (step === null) {
    return <p className="text-xs text-fg-secondary">{t('step.noDocument')}</p>;
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-primary">{t('step.title')}</h3>
        <span className="text-[11px] tabular-nums text-fg-secondary">
          {t('step.position', { position: position + 1, of: STEPS.length })}
        </span>
      </div>

      <ol className="flex flex-col gap-0.5">
        {STEPS.map((entry, index) => {
          const state = index < position ? 'done' : index === position ? 'current' : 'ahead';
          const label = labels.step[entry];
          return (
            <li key={entry}>
              {state === 'done' ? (
                <button
                  type="button"
                  className="text-[11px] text-fg-secondary underline-offset-2 hover:underline"
                  aria-label={tw('revisitStep', { step: label })}
                  onClick={() => {
                    setRevisitTarget(entry);
                  }}
                >
                  {label}
                </button>
              ) : (
                <span
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'text-[11px]',
                    state === 'current' && 'font-medium text-fg-primary',
                    state === 'ahead' && 'opacity-60',
                  )}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-sm font-medium text-fg-primary">{labels.step[step.step]}</p>
      {/* What the step expects, before the report about whether it got it. The
          gate's own prose says what is wrong; this says what was asked for,
          which is the thing a reader needs first and the thing Rust never
          sends. */}
      <p className="text-[11px] text-fg-secondary">{expects(step.step, t)}</p>

      {gate === null ? (
        <p className="text-[11px] text-fg-secondary">{t('step.noReport')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p
            className={cn(
              'text-[11px] font-medium',
              gate.pass
                ? 'text-[color:var(--severity-success)]'
                : 'text-[color:var(--severity-error)]',
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
            // A step with nothing to measure is not a step that passed by
            // luck, and saying so is what stops an empty green line from
            // reading as a verdict about the pixels.
            <p className="text-[11px] text-fg-secondary">{t('step.noChecks')}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="px-2 py-1 text-[11px]"
          disabled={loading}
          onClick={() => {
            void check();
          }}
        >
          {t('step.check')}
        </Button>
        <Button
          variant="primary"
          className="px-2 py-1 text-[11px]"
          // Disabled from `canAdvance`, which Rust computes as the gate passing
          // and the step not being the last one. Guessing it here from the
          // report alone would offer an advance off the end of the workflow.
          disabled={loading || !step.canAdvance}
          onClick={() => {
            void advance();
          }}
        >
          {t('step.advance')}
        </Button>
        {offerForce && (
          <Button
            variant="ghost"
            className="px-2 py-1 text-[11px]"
            disabled={loading}
            onClick={() => {
              setForcing(true);
            }}
          >
            {tw('forceAdvance')}
          </Button>
        )}
      </div>

      {refusal !== null && (
        <p role="alert" className="text-[11px] text-[color:var(--severity-error)]">
          {refusal}
        </p>
      )}

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
    </div>
  );
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
        failing
          ? 'border-s-[color:var(--severity-error)]'
          : 'border-s-[color:var(--severity-success)]',
      )}
    >
      <p className="font-medium text-fg-primary">
        {/* The check's own stable name, shown as it is. It is the word that
            appears in the MCP report an agent reads and in this rail, and
            translating it would leave the two unable to refer to the same
            check. */}
        <span className="font-mono">{check.name}</span>
        <span className="ms-1 font-normal text-fg-muted">
          {failing ? t('step.checkFailed') : t('step.checkVerified')}
        </span>
      </p>
      {check.detail !== undefined && <p className="text-fg-secondary">{check.detail}</p>}
      {check.hint !== undefined && <p className="text-fg-primary">{check.hint}</p>}
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
