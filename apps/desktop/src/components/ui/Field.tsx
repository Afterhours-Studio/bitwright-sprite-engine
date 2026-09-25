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
import { useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The studio's text field: the new sprite dialog's name input. A step darker
 * than the section it sits in, a hairline border, and pink when focused, which
 * is the one colour the layout keeps for "this is where you are".
 *
 * Exported because `NumberField` is the same control with a stepper drawn on
 * top of it, and the two sit in the same column. Copying the classes over
 * there would make them identical today and similar later.
 */
export const INPUT_CONTROL = cn(
  'w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5',
  'text-xs text-neutral-100 transition-colors',
  'placeholder:text-neutral-500',
  'focus:border-pink-500 focus:outline-none',
  'disabled:cursor-not-allowed disabled:border-neutral-800/40 disabled:bg-neutral-900/40 disabled:text-neutral-600',
);

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Label text. Always a translated string. */
  label: string;
  /** Explanation shown under the control, such as why it is disabled. */
  hint?: string;
  /**
   * A control that belongs to this input, drawn inside its trailing edge.
   *
   * For the things that act on the field's own content - revealing a password,
   * clearing a search. Under the field they read as a separate step; inside it
   * they read as part of the control, which is what they are.
   */
  trailing?: ReactNode;
}

/** A labelled text or number input. */
export function Field({ label, hint, className, trailing, ...rest }: FieldProps): ReactElement {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[11px] font-medium text-neutral-400">
        {label}
      </label>
      {trailing === undefined ? (
        <input id={id} className={INPUT_CONTROL} {...rest} />
      ) : (
        <div className="relative">
          {/* Padded on the trailing edge by the control's width, so text
              scrolls under the label rather than behind the button. */}
          <input id={id} className={cn(INPUT_CONTROL, 'pe-10')} {...rest} />
          <span className="absolute inset-y-0 end-1 flex items-center">{trailing}</span>
        </div>
      )}
      {hint !== undefined && <p className="text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}

export interface TextAreaFieldProps {
  /** Label text. Always a translated string. */
  label: string;
  /** Current value. */
  value: string;
  /** Placeholder text. Always a translated string. */
  placeholder?: string;
  /** Number of visible rows. */
  rows?: number;
  /** Called with the new value. */
  onValueChange: (value: string) => void;
}

/** A labelled multi-line input, for text that runs past a single line. */
export function TextAreaField({
  label,
  value,
  placeholder,
  rows = 3,
  onValueChange,
}: TextAreaFieldProps): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-neutral-400">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        className={cn(INPUT_CONTROL, 'resize-none')}
      />
    </div>
  );
}

export interface ToggleProps {
  /** Label text. Always a translated string. */
  label: string;
  /** Whether the option is on. */
  checked: boolean;
  /** Whether the option can be changed. */
  disabled?: boolean;
  /** Explanation shown under the control, such as why it is disabled. */
  hint?: string;
  /** Called with the new state. */
  onCheckedChange: (checked: boolean) => void;
}

/** A labelled on and off switch. */
export function Toggle({
  label,
  checked,
  disabled = false,
  hint,
  onCheckedChange,
}: ToggleProps): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className={cn(
            'text-[11px] font-medium',
            disabled ? 'text-neutral-600' : 'text-neutral-400',
          )}
        >
          {label}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => {
            onCheckedChange(!checked);
          }}
          className={cn(
            'h-5 w-9 shrink-0 rounded-full border p-0.5 transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pink-500',
            disabled && 'cursor-not-allowed border-neutral-800/40 bg-neutral-900/40',
            !disabled && checked && 'border-sky-400 bg-sky-600',
            !disabled && !checked && 'border-neutral-700 bg-neutral-800',
          )}
        >
          <span
            className={cn(
              'block h-3.5 w-3.5 rounded-full transition-transform',
              checked ? 'translate-x-4 bg-white' : 'translate-x-0 bg-neutral-400',
            )}
          />
        </button>
      </div>
      {hint !== undefined && <p className="text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}

export interface StatusDotProps {
  /** What the dot is reporting. */
  tone: 'ready' | 'busy' | 'off';
  /** Accessible description. Always a translated string. */
  label: string;
  /** Content shown beside the dot. */
  children?: ReactNode;
}

/** A small coloured dot reporting availability. */
export function StatusDot({ tone, label, children }: StatusDotProps): ReactElement {
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          tone === 'ready' && 'bg-emerald-400',
          tone === 'busy' && 'bg-amber-400',
          tone === 'off' && 'bg-neutral-600',
        )}
      />
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}
