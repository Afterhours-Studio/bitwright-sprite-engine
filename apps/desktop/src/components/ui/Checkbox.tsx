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

import { cn } from '@/lib/cn';

export interface CheckboxProps {
  /** Label text. Always a translated string. */
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Keep the label for assistive technology only (sr-only span). */
  hideLabel?: boolean;
  /** 'sm': 12px box, text-[11px]; 'md' (default): 14px box, text-xs. */
  size?: 'sm' | 'md';
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/** The box, measured against the label beside it rather than against its text. */
const BOX_SIZE: Record<'sm' | 'md', string> = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
};

/** The label's text size, kept a step below the surrounding prose. */
const TEXT_SIZE: Record<'sm' | 'md', string> = {
  sm: 'text-[11px]',
  md: 'text-xs',
};

/**
 * A checkbox.
 *
 * Written rather than using `<input type="checkbox">`, because a native
 * checkbox is drawn by the platform and ignores the theme: it keeps the
 * system's own colours and corners, and it cannot animate. The behaviour of
 * the native control is kept, which is the part worth having - the label
 * toggles it, a checkbox announces itself as one, and a disabled box cannot be
 * changed.
 *
 * The tick is a single path whose dash is shortened as the box is checked, so
 * the mark draws itself in rather than appearing all at once. Nothing here
 * calls `t()`: the label arrives already translated.
 */
export function Checkbox({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  hideLabel = false,
  size = 'md',
  className,
}: CheckboxProps): ReactElement {
  const toggle = (): void => {
    if (disabled) {
      return;
    }
    onCheckedChange(!checked);
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
        TEXT_SIZE[size],
        disabled ? 'cursor-not-allowed text-fg-muted' : 'text-fg-secondary hover:text-fg-primary',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid shrink-0 place-items-center rounded-sm border',
          'transition-[background-color,border-color,transform] duration-150 active:scale-90',
          BOX_SIZE[size],
          disabled
            ? 'border-line-subtle bg-surface-disabled'
            : checked
              ? 'border-transparent bg-accent text-accent-fg'
              : 'border-line-input bg-surface-input text-transparent',
        )}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-full w-full" fill="none">
          <path
            d="M2.5 6.5L5 9l4.5-5.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={checked ? 0 : 1}
            className="transition-[stroke-dashoffset] duration-150 ease-out"
          />
        </svg>
      </span>
      <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
    </button>
  );
}
