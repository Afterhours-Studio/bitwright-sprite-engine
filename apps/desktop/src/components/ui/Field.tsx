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
 * Inputs move away from the text colour: white in light mode, near black in
 * dark. In light mode the field is the same white as the card it sits on, so
 * its border is what separates the two, which is why it uses the stronger
 * input border rather than the subtle one.
 *
 * Exported because `NumberField` is the same control with a stepper drawn on
 * top of it, and the two sit in the same column. Copying the classes over
 * there would make them identical today and similar later.
 */
export const INPUT_CONTROL = cn(
  'w-full rounded-sm border border-line-input bg-surface-input px-3 py-2',
  'text-sm text-fg-primary transition-colors',
  'placeholder:text-fg-placeholder',
  'focus:border-line-focus',
  'disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-surface-disabled disabled:text-fg-muted',
);

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Label text. Always a translated string. */
  label: string;
  /** Explanation shown under the control, such as why it is disabled. */
  hint?: string;
}

/** A labelled text or number input. */
export function Field({ label, hint, className, ...rest }: FieldProps): ReactElement {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <input id={id} className={INPUT_CONTROL} {...rest} />
      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
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

/** A labelled multi-line input, for prompts. */
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
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
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
          className={cn('text-xs font-medium', disabled ? 'text-fg-muted' : 'text-fg-secondary')}
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
            'h-5 w-9 shrink-0 rounded-pill border p-0.5 transition-colors',
            disabled && 'cursor-not-allowed border-line-subtle bg-surface-disabled',
            !disabled && checked && 'border-transparent bg-accent',
            !disabled && !checked && 'border-line-input bg-surface-input',
          )}
        >
          <span
            className={cn(
              'block h-3.5 w-3.5 rounded-full transition-transform',
              checked ? 'translate-x-4 bg-accent-fg' : 'translate-x-0 bg-fg-secondary',
            )}
          />
        </button>
      </div>
      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
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
          tone === 'ready' && 'bg-accent',
          tone === 'busy' && 'bg-fg-secondary',
          tone === 'off' && 'bg-fg-muted',
        )}
      />
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}
