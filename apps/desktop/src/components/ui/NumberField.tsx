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
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { INPUT_CONTROL } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

/**
 * How the value is interpreted, which decides what may be typed into it.
 *
 * Integer is the default because almost every number in this application is a
 * count of something: pixels, steps, images, colours. Decimal exists for the
 * one parameter that is genuinely fractional.
 */
export type NumberFieldMode = 'integer' | 'decimal';

/** Characters that cannot appear in an integer, but that a number input accepts. */
const NON_INTEGER_KEYS = ['.', ',', 'e', 'E', '+'];

/** How long the first repeat waits, so a single click is not read as a hold. */
const REPEAT_DELAY_MS = 400;

/** The fastest the repeat is allowed to get. */
const REPEAT_MIN_MS = 40;

/** How much each repeat shortens the wait for the next one. */
const REPEAT_DECAY = 0.82;

interface NumberFieldBase {
  /** Label text. Always a translated string. */
  label: string;
  /** Lowest accepted value. */
  min?: number;
  /** Highest accepted value. */
  max?: number;
  /** How far one press of the stepper moves. Whole units in integer mode. */
  step?: number;
  /** How the value is interpreted. */
  mode?: NumberFieldMode;
  /** Whether to draw the stepper. */
  stepper?: boolean;
  /** Whether the control can be changed. */
  disabled?: boolean;
  /** Explanation shown under the control, such as why it is disabled. */
  hint?: string;
  /** Placeholder text. Always a translated string. */
  placeholder?: string;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * A number field, in one of two shapes.
 *
 * A clearable field can be emptied, and empty means null: a seed nobody chose,
 * a palette nobody limited. A field that is not clearable always holds a
 * number, and its callback is typed to say so, which is what stops every
 * caller of a required parameter from having to handle a null that cannot
 * happen.
 */
export type NumberFieldProps =
  | (NumberFieldBase & {
      /** The field cannot be emptied. */
      clearable?: false;
      /** Current value. */
      value: number;
      /** Called with the new value. */
      onValueChange: (value: number) => void;
    })
  | (NumberFieldBase & {
      /** The field can be emptied, and empty means null. */
      clearable: true;
      /** Current value, or null when the field is empty. */
      value: number | null;
      /** Called with the new value, or null when the field was emptied. */
      onValueChange: (value: number | null) => void;
    });

/**
 * Renders a value as field text.
 *
 * @param value - The value, or null for an empty field.
 * @returns What the field should show.
 */
function text(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * Reads field text as a number.
 *
 * @param draft - What the field currently shows.
 * @returns The number, or null when the field is empty or holds no number.
 */
function parse(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How many decimal places a step implies.
 *
 * @param step - The step size.
 * @returns Places to round to, bounded to what `toFixed` accepts.
 */
function decimalsOf(step: number): number {
  const written = String(Math.abs(step));
  const point = written.indexOf('.');
  // A step written in exponent form reports no decimal point at all, so the
  // count is bounded rather than trusted.
  return point === -1 ? 0 : Math.min(10, written.length - point - 1);
}

/**
 * Rounds a value to what the mode can represent.
 *
 * Float arithmetic is why this exists rather than the raw sum: stepping 7 by
 * 0.5 twice gives 8 here and 8.000000000000002 without it.
 *
 * @param value - The value to round.
 * @param mode - How the value is interpreted.
 * @param step - The step size, which sets the decimal places in decimal mode.
 * @returns The rounded value.
 */
function round(value: number, mode: NumberFieldMode, step: number): number {
  if (mode === 'integer') {
    return Math.round(value);
  }
  return Number(value.toFixed(decimalsOf(step)));
}

/**
 * Holds a value inside its range.
 *
 * @param value - The value to clamp.
 * @param min - Lowest accepted value, if there is one.
 * @param max - Highest accepted value, if there is one.
 * @returns The value, moved to the nearest bound if it was outside.
 */
function clamp(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) {
    return min;
  }
  if (max !== undefined && value > max) {
    return max;
  }
  return value;
}

/**
 * A number input with a stepper this application draws itself.
 *
 * WHY IT EXISTS
 *
 * The same reason `Select` exists. A number input draws the platform's own
 * spin buttons: two grey arrows in the system's colours and the system's size,
 * which ignore the theme completely and look like a hole in the interface. The
 * arrows are switched off for every number input in `styles/global.css`, and
 * this component draws the replacement.
 *
 * INTEGER BY DEFAULT
 *
 * Nearly every number in this application is a count, and a count with a
 * decimal point in it is a bug on its way to the engine. Integer mode does not
 * merely look integral: the characters that could make a float are refused at
 * the keystroke, a paste is rounded before it lands, and the value is rounded
 * again on every commit. Guidance is the one genuinely fractional parameter,
 * and it opts into decimal mode with its own step.
 *
 * THE DRAFT
 *
 * The field keeps the text being typed, not the number. A controlled number
 * would fight the user: clearing the field to retype it would immediately
 * refill from the store, and normalising every keystroke would rewrite the
 * text under the caret. The draft is resynchronised only when the value
 * arrives from outside and differs from what this field last emitted.
 *
 * Nothing here ever emits NaN. An empty or unreadable field emits null when it
 * is clearable and emits nothing at all when it is not, in which case the
 * field is restored on commit from the value that is still in the store.
 */
export function NumberField(props: NumberFieldProps): ReactElement {
  const {
    label,
    min,
    max,
    step = 1,
    mode = 'integer',
    stepper = true,
    disabled = false,
    hint,
    placeholder,
    className,
  } = props;

  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => text(props.value));

  // The last value this field and its parent agree on. A ref rather than
  // state, because the repeat timer reads it on every tick and state captured
  // in the timer's closure would be the value from the render the press began
  // in, which would make a held button step from the same number forever.
  const committed = useRef<number | null>(props.value);

  const repeat = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRepeat = useCallback((): void => {
    if (repeat.current !== null) {
      clearTimeout(repeat.current);
      repeat.current = null;
    }
  }, []);

  useEffect(() => {
    // Every press ends in a release, and an unmount is one of them.
    return stopRepeat;
  }, [stopRepeat]);

  useEffect(() => {
    if (props.value !== committed.current) {
      committed.current = props.value;
      setDraft(text(props.value));
    }
  }, [props.value]);

  // Whole units in integer mode whatever the caller passed, because half a
  // pixel of width is not a thing the engine can be asked for.
  const unit = mode === 'integer' ? Math.max(1, Math.round(step)) : step;
  const allowsNegative = min === undefined || min < 0;

  /**
   * Sends a value to the parent, and remembers what was sent.
   *
   * A field that is not clearable sends nothing for an empty draft rather than
   * sending null, so that emptying it to retype does not blank the parameter
   * in the store on the way.
   *
   * @param next - The value to send, or null for an empty field.
   */
  const emit = (next: number | null): void => {
    if (next === committed.current) {
      // The parent already holds this. Emptying a field emits once, on the
      // keystroke, and the commit that follows on blur has nothing to add.
      return;
    }
    if (props.clearable === true) {
      committed.current = next;
      props.onValueChange(next);
      return;
    }
    if (next !== null) {
      committed.current = next;
      props.onValueChange(next);
    }
  };

  /**
   * Rounds and clamps a value into something the parameter accepts.
   *
   * @param value - The value to settle.
   * @returns The value the store should hold.
   */
  const settle = (value: number): number => clamp(round(value, mode, step), min, max);

  const stepOnce = (direction: 1 | -1): void => {
    const current = committed.current;
    const next = current === null ? settle(min ?? 0) : settle(current + direction * unit);
    if (next === current) {
      // Already at the bound. Holding the button will not change that, so the
      // repeat stops instead of spinning against the clamp until release.
      stopRepeat();
      return;
    }
    setDraft(text(next));
    emit(next);
  };

  // The repeat outlives the render that started it, so each tick calls through
  // a ref. The closure the timer was created with would keep stepping from the
  // value the field held when the button went down.
  const stepLatest = useRef(stepOnce);
  useEffect(() => {
    stepLatest.current = stepOnce;
  });

  const startRepeat = (direction: 1 | -1): void => {
    stopRepeat();
    input.current?.focus();
    stepOnce(direction);

    // A chain of timeouts rather than an interval, because the wait shortens
    // as the press goes on: a stepper that repeats at one fixed rate is either
    // too slow to cross a range or too fast to land on a number.
    let delay = REPEAT_DELAY_MS;
    const tick = (): void => {
      stepLatest.current(direction);
      delay = Math.max(REPEAT_MIN_MS, delay * REPEAT_DECAY);
      if (repeat.current !== null) {
        repeat.current = setTimeout(tick, delay);
      }
    };
    repeat.current = setTimeout(tick, delay);
  };

  const commit = (): void => {
    stopRepeat();
    const parsed = parse(draft);
    if (parsed === null) {
      if (props.clearable === true) {
        setDraft('');
        emit(null);
        return;
      }
      // A required field cannot be left showing nothing while the store still
      // holds a number: the two would disagree, and the run would use a value
      // that is not on screen.
      setDraft(text(committed.current));
      return;
    }
    const next = settle(parsed);
    setDraft(text(next));
    emit(next);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setDraft(next);

    const parsed = parse(next);
    if (parsed === null) {
      emit(null);
      return;
    }
    // Rounded but not clamped. Clamping mid-word rewrites the field under the
    // caret, so a range is enforced on commit; rounding costs nothing here,
    // because in integer mode a fraction could not have been typed anyway.
    emit(mode === 'integer' ? Math.round(parsed) : parsed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      commit();
      return;
    }

    if (stepper && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // The input steps on the arrows by itself. Without this it would step
      // once for the browser and once for us.
      event.preventDefault();
      stepOnce(event.key === 'ArrowUp' ? 1 : -1);
      return;
    }

    // Shortcuts are not text. Swallowing Ctrl+E here would break a key the
    // user has a different meaning for.
    if (mode !== 'integer' || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (NON_INTEGER_KEYS.includes(event.key) || (event.key === '-' && !allowsNegative)) {
      event.preventDefault();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    // A number input supports no selection API at all, so there is no way to
    // splice pasted text in at the caret. The paste replaces the field, which
    // is what pasting into a field this small means in practice, and it is the
    // only way to guarantee that a pasted "3.7" cannot reach the store as a
    // float.
    event.preventDefault();
    const parsed = parse(event.clipboardData.getData('text'));
    if (parsed === null) {
      return;
    }
    const next = settle(parsed);
    setDraft(text(next));
    emit(next);
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs font-medium', disabled ? 'text-fg-muted' : 'text-fg-secondary')}
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          ref={input}
          type="number"
          // Numeric rather than decimal in integer mode, so a touch keyboard
          // offers digits and no decimal point.
          inputMode={mode === 'integer' ? 'numeric' : 'decimal'}
          value={draft}
          min={min}
          max={max}
          step={unit}
          disabled={disabled}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commit}
          className={cn(INPUT_CONTROL, stepper && 'pe-8')}
        />

        {stepper && (
          <div className="absolute inset-y-px end-px flex w-7 flex-col overflow-hidden rounded-e-sm">
            <StepperButton
              label={t('actions.increase', { label })}
              direction={1}
              disabled={disabled}
              onPress={startRepeat}
              onRelease={stopRepeat}
            />
            <StepperButton
              label={t('actions.decrease', { label })}
              direction={-1}
              disabled={disabled}
              onPress={startRepeat}
              onRelease={stopRepeat}
            />
          </div>
        )}
      </div>

      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
    </div>
  );
}

interface StepperButtonProps {
  /** Accessible name. Always a translated string. */
  label: string;
  /** Which way this button moves the value. */
  direction: 1 | -1;
  /** Whether the control can be used. */
  disabled: boolean;
  /** Called as the press begins. */
  onPress: (direction: 1 | -1) => void;
  /** Called on every way the press can end. */
  onRelease: () => void;
}

/**
 * One half of the stepper.
 *
 * Kept out of the tab order but not out of the accessibility tree. The field
 * itself is a spin button, which a screen reader announces as one and whose
 * arrow keys already do this job; adding two tab stops in front of each of the
 * eight number fields in the parameter panel would make it materially worse to
 * move through with a keyboard. `aria-hidden` would be the wrong answer to
 * that, because it would hide a control that a screen reader user can still
 * reach and press.
 */
function StepperButton({
  label,
  direction,
  disabled,
  onPress,
  onRelease,
}: StepperButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      tabIndex={-1}
      onPointerDown={(event) => {
        // The press must not move focus onto the button. Prevented rather than
        // put back afterwards, so the caret survives; the field is focused
        // explicitly instead, which is what a stepper does.
        event.preventDefault();
        onPress(direction);
      }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
      className={cn(
        'flex flex-1 items-center justify-center transition-colors',
        disabled
          ? 'cursor-not-allowed text-fg-muted'
          : 'text-fg-secondary hover:bg-surface-content-alt hover:text-fg-primary',
      )}
    >
      {/* The same weight as the chevron on `Select`, so a column of fields and
          selects reads as one set of controls. */}
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3" fill="none">
        <path
          d={direction === 1 ? 'M2.5 7.5L6 4l3.5 3.5' : 'M2.5 4.5L6 8l3.5-3.5'}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
