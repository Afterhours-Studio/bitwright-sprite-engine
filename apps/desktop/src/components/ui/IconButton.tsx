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
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Always a translated string. */
  label: string;
  /** Whether hover should read as destructive, for a window close button. */
  danger?: boolean;
  /** The icon. */
  children: ReactNode;
}

/**
 * A round icon button.
 *
 * The circular affordance is the reference language for anything that is an
 * action rather than a choice: window controls, the theme switch, add buttons.
 * A pill is a choice; a circle is an action.
 *
 * `label` is the accessible name and nothing else. It is deliberately not also
 * written to `title`: that attribute is drawn by the operating system, in its
 * own font and colours and after its own delay, none of which follow the
 * theme. A caller that wants a visible label on hover wraps the button in
 * `Tooltip`, which is drawn by the application.
 */
export function IconButton({
  label,
  danger = false,
  className,
  disabled,
  children,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
        'transition-colors',
        disabled && 'cursor-not-allowed bg-surface-disabled text-fg-muted',
        !disabled &&
          danger &&
          'bg-surface-content text-fg-secondary hover:bg-danger hover:text-danger-fg',
        !disabled &&
          !danger &&
          'bg-surface-content text-fg-secondary shadow-sm hover:text-fg-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
