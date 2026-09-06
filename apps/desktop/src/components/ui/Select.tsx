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
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { Overlay } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';

/** One choice in a select. */
export interface SelectOption {
  value: string;
  label: string;
  /**
   * A short code shown in a square before the label, such as a language tag.
   *
   * Present for lists whose labels are written in their own subject rather than
   * in the reading language: with the interface in Vietnamese, the entry for
   * English still reads "Tiếng Anh", and the entry for Vietnamese reads
   * "Tiếng Việt", so the two look alike at a glance. A constant EN or VI in
   * front is the part that can be picked out without reading.
   *
   * Shown only in the open list, which is the only place there is anything to
   * tell apart. On the closed control the choice has already been made, so the
   * code would be decoration.
   */
  tag?: string;
}

export interface SelectProps {
  /** Label text. Always a translated string. */
  label: string;
  /** Current value. */
  value: string;
  /** The choices. */
  options: SelectOption[];
  /** Whether the control can be changed. */
  disabled?: boolean;
  /** Explanation shown under the control, such as why it is disabled. */
  hint?: string;
  /** Called with the new value. */
  onValueChange: (value: string) => void;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * A dropdown.
 *
 * Written rather than using `<select>`, because a native select renders its
 * list with the platform's own colours and corners. It ignores the theme
 * completely, and on Windows it is a grey slab with square edges in the middle
 * of a rounded, themed interface.
 *
 * The keyboard behaviour of the native control is kept, because that is the
 * part worth having: Enter, Space, and the arrow keys open it; the arrows move
 * the highlight; Home and End jump; Enter commits; Escape cancels.
 */
export function Select({
  label,
  value,
  options,
  disabled = false,
  hint,
  onValueChange,
  className,
}: SelectProps): ReactElement {
  const id = useId();
  const listId = `${id}-list`;
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  const selected = options.findIndex((option) => option.value === value);
  const current = options[selected] ?? options[0];

  useEffect(() => {
    if (open) {
      setActive(selected === -1 ? 0 : selected);
    }
  }, [open, selected]);

  const commit = (index: number): void => {
    const option = options[index];
    if (option !== undefined) {
      onValueChange(option.value);
    }
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return;
    }

    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(index + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(active);
        break;
      default:
        break;
    }
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs font-medium', disabled ? 'text-fg-muted' : 'text-fg-secondary')}
      >
        {label}
      </label>

      <div ref={container} className="relative">
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => {
            setOpen((was) => !was);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-sm border px-3 py-2',
            'text-left text-sm transition-colors',
            disabled
              ? 'cursor-not-allowed border-line-subtle bg-surface-disabled text-fg-muted'
              : 'border-line-input bg-surface-input text-fg-primary',
            open && !disabled && 'border-line-focus',
          )}
        >
          <span className="truncate">{current?.label ?? ''}</span>
          <Chevron open={open} />
        </button>

        <Overlay open={open} className="max-h-64 overflow-auto">
          <ul id={listId} role="listbox" aria-label={label}>
            {options.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  onPointerEnter={() => {
                    setActive(index);
                  }}
                  onClick={() => {
                    commit(index);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2',
                    'text-left text-sm transition-colors',
                    index === active ? 'bg-surface-content-alt' : 'bg-transparent',
                    option.value === value ? 'text-fg-primary' : 'text-fg-secondary',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.tag !== undefined && <Tag text={option.tag} />}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {option.value === value && <Tick />}
                </button>
              </li>
            ))}
          </ul>
        </Overlay>
      </div>

      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
    </div>
  );
}

/**
 * The square code shown in front of a label.
 *
 * Sized to the line box of the `text-sm` beside it rather than to its own text,
 * so the square matches the height of the label exactly and the row keeps one
 * baseline. `leading-none` on the code stops its own line height from making
 * the box taller than the square it is supposed to be.
 */
function Tag({ text }: { text: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-sm',
        'bg-surface-well text-[10px] font-semibold leading-none text-fg-secondary',
      )}
    >
      {text}
    </span>
  );
}

/** The disclosure arrow, which turns as the list opens. */
function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn('h-3 w-3 shrink-0 transition-transform duration-150', open && 'rotate-180')}
      fill="none"
    >
      <path
        d="M2.5 4.5L6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Marks the chosen option. */
function Tick(): ReactElement {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none">
      <path d="M2 6.5L4.8 9 10 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
