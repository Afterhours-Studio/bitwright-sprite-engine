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

import type { ButtonHTMLAttributes, ReactNode, ReactElement } from 'react';

import { cn } from '@/lib/cn';

/** How prominent a button is. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** How prominent the button is. */
  variant?: ButtonVariant;
  /** Content. Always a translated string, never a literal. */
  children: ReactNode;
}

/**
 * A button.
 *
 * The disabled state uses the disabled surface and the muted text token rather
 * than opacity. Fading a container lets the layer underneath bleed through,
 * which breaks the elevation order the whole palette depends on.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-fg-primary border border-line-subtle hover:border-line',
  ghost: 'bg-transparent text-fg-secondary hover:bg-surface-2 hover:text-fg-primary',
};

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
        'inline-flex items-center justify-center gap-2 rounded-pill px-4 py-2',
        'text-sm font-medium transition-colors',
        disabled ? 'cursor-not-allowed bg-surface-disabled text-fg-muted' : VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
