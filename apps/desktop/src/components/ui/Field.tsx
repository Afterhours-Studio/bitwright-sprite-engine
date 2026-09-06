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

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/cn';

/** Inputs are sunken, one step below the surface they sit on, which is what
 *  makes them read as something to type into rather than something to press. */
const CONTROL = cn(
  'w-full rounded-sm border border-line-subtle bg-surface-sunken px-3 py-2',
  'text-sm text-fg-primary transition-colors',
  // A placeholder is read, so it is secondary rather than muted.
  'placeholder:text-fg-secondary',
  'disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-fg-muted',
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
      <input id={id} className={CONTROL} {...rest} />
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
        className={cn(CONTROL, 'resize-none')}
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
            'h-5 w-9 shrink-0 rounded-pill border border-line-subtle p-0.5 transition-colors',
            disabled && 'cursor-not-allowed bg-surface-disabled',
            !disabled && (checked ? 'bg-accent' : 'bg-surface-sunken'),
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

export interface SelectFieldProps {
  /** Label text. Always a translated string. */
  label: string;
  /** Current value. */
  value: string;
  /** Options, already translated where they are user facing. */
  options: { value: string; label: string }[];
  /** Whether the control can be changed. */
  disabled?: boolean;
  /** Explanation shown under the control, such as why it is disabled. */
  hint?: string;
  /** Called with the new value. */
  onValueChange: (value: string) => void;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/** A labelled dropdown. */
export function SelectField({
  label,
  value,
  options,
  disabled = false,
  hint,
  onValueChange,
  className,
}: SelectFieldProps): ReactElement {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
    </div>
  );
}

export interface StatusDotProps {
  /** What the dot is reporting. */
  tone: 'ready' | 'busy' | 'off';
  /** Accessible description. Always a translated string. */
  label: string;
  /** Extra classes for layout only, never colour. */
  children?: ReactNode;
}

/** A small coloured dot reporting availability. */
export function StatusDot({ tone, label, children }: StatusDotProps): ReactElement {
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 rounded-full',
          tone === 'ready' && 'bg-accent',
          tone === 'busy' && 'bg-fg-secondary',
          tone === 'off' && 'bg-fg-secondary',
        )}
      />
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}
