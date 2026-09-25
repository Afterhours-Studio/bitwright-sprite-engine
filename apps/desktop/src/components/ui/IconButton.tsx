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
 * A square icon button, drawn like the buttons on the stage's floating
 * panels: no surface at rest, a neutral one under the pointer, so a row of
 * them reads as one strip of actions rather than a row of boxes.
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
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded',
        'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pink-500',
        disabled && 'cursor-not-allowed text-neutral-600',
        !disabled && danger && 'text-neutral-400 hover:bg-danger hover:text-danger-fg',
        !disabled && !danger && 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
