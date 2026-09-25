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

/**
 * How an active pill is marked.
 *
 * Two levels, because the interface has two levels of pill row. Primary
 * choices take pink, the layout's colour for the current item. A secondary
 * row of filters takes sky, the colour of a toggle that is on, which reads as
 * selected without competing with the primary row for attention.
 */
export type PillTone = 'accent' | 'anchor';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this pill is the current choice. */
  active?: boolean;
  /** How the active state is marked. */
  tone?: PillTone;
  /** Optional leading element, such as a status dot. */
  leading?: ReactNode;
  /** Label. Always a translated string. */
  children: ReactNode;
}

const ACTIVE: Record<PillTone, string> = {
  accent: 'bg-pink-600 border-pink-500 text-white',
  anchor: 'bg-sky-600 border-sky-400 text-white',
};

/**
 * A pill shaped toggle, used for navigation and for filters.
 *
 * Sized to its content. A caller that wants a full-width pill passes `w-full`;
 * the reverse does not work, because two width utilities have equal specificity
 * and Tailwind's own emission order decides the winner.
 */
export function Pill({
  active = false,
  tone = 'accent',
  leading,
  className,
  disabled,
  children,
  ...rest
}: PillProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2.5 py-1',
        'text-left text-[11px] font-medium transition-colors',
        disabled && 'cursor-not-allowed border-neutral-800/40 bg-neutral-900/40 text-neutral-600',
        !disabled && active && ACTIVE[tone],
        !disabled &&
          !active &&
          'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-100',
        className,
      )}
      {...rest}
    >
      {leading}
      <span className="truncate">{children}</span>
    </button>
  );
}
