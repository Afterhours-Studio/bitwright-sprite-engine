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

/** How prominent a button is, and whether it reads as destructive. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** How prominent the button is. */
  variant?: ButtonVariant;
  /** Content. Always a translated string, never a literal. */
  children: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-pink-600 hover:bg-pink-500 border border-pink-500 text-white font-semibold shadow-sm shadow-pink-600/30',
  secondary:
    'bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-neutral-100',
  ghost:
    'bg-transparent border border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
  // The one button that says what it will destroy has to look like it at rest,
  // not only under the pointer, because it is read before it is reached for.
  danger: 'bg-red-600 hover:bg-red-500 border border-red-500 text-white font-semibold',
};

/**
 * A button, in the studio's small type: `text-xs` on a 4px corner, the size
 * every control in the editor's header and panels is drawn at.
 *
 * The disabled state is its own dim surface rather than opacity. Fading a
 * button lets whatever is underneath bleed through, and on the stage's
 * floating panels that is the checker, which reads as noise, not as "off".
 */
export function Button({
  variant = 'secondary',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5',
        'text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pink-500',
        disabled
          ? 'cursor-not-allowed border border-neutral-800/40 bg-neutral-900/40 text-neutral-600'
          : VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
