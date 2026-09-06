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

/**
 * A list that can be searched, and typed into when the list is not enough.
 *
 * A provider can offer hundreds of models, so a plain dropdown is a scroll
 * through a wall of near-identical identifiers. Typing filters it.
 *
 * The value is still free text, because the list is what a provider happened
 * to report and a model it does not list may still work - a preview name, or
 * one the account has and the catalogue does not. Refusing to accept anything
 * but a listed entry would trade a real limitation for an invented one.
 */

import { useCallback, useId, useRef, useState, type ReactElement } from 'react';

import { Overlay } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { INPUT_CONTROL } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

export interface ComboBoxProps {
  /** Label text. Always a translated string. */
  label: string;
  /** Current value, which need not be one of the options. */
  value: string;
  /** What the provider listed. May be empty before anything is fetched. */
  options: string[];
  /** Shown when the field is empty. */
  placeholder?: string;
  /** Explanation shown under the control. */
  hint?: string;
  /** Shown in place of the list when nothing has been fetched yet. */
  emptyHint: string;
  /** Whether the control can be changed. */
  disabled?: boolean;
  /** Called with the new value, whether typed or chosen. */
  onValueChange: (value: string) => void;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * The field and its filtered list.
 *
 * @param props - Label, value, options and callbacks.
 * @returns The control.
 */
export function ComboBox({
  label,
  value,
  options,
  placeholder,
  hint,
  emptyHint,
  disabled = false,
  onValueChange,
  className,
}: ComboBoxProps): ReactElement {
  const id = useId();
  const listId = `${id}-list`;
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  // Filtered on the value itself: what is typed is both the value and the
  // search, which is what makes this one control rather than a field beside a
  // list that disagree about what is selected.
  const needle = value.trim().toLowerCase();
  const matches = options.filter((option) => option.toLowerCase().includes(needle));
  const shown = needle === '' ? options : matches;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs font-medium', disabled ? 'text-fg-muted' : 'text-fg-secondary')}
      >
        {label}
      </label>

      <div ref={container} className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onValueChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onClick={() => {
            // Opening on a press as well as on focus. A control that looks
            // like a dropdown and does nothing when pressed is a control that
            // reads as broken, and a second press on an already focused field
            // would otherwise do nothing at all.
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              setOpen(false);
            }
          }}
          className={cn(INPUT_CONTROL, 'pe-9', disabled && 'cursor-not-allowed')}
        />

        {/* The arrow is what says this is a list and not a text field. It
            takes no pointer events, so pressing it presses the input beneath
            and opens the list, which is what a reader expects of it. */}
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center">
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cn(
              'h-3 w-3 text-fg-secondary transition-transform duration-150',
              open && 'rotate-180',
            )}
            fill="none"
          >
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <Overlay open={open && shown.length > 0} className="max-h-64 overflow-auto">
          <ul id={listId} role="listbox" aria-label={label}>
            {shown.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option === value}
                  tabIndex={-1}
                  onClick={() => {
                    onValueChange(option);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center rounded-sm px-3 py-2 text-left text-sm',
                    'transition-colors hover:bg-surface-content-alt',
                    option === value ? 'text-fg-primary' : 'text-fg-secondary',
                  )}
                >
                  <span className="truncate">{option}</span>
                </button>
              </li>
            ))}
          </ul>
        </Overlay>

        <Overlay open={open && options.length === 0} className="p-2">
          <p className="text-xs text-fg-secondary">{emptyHint}</p>
        </Overlay>
      </div>

      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
    </div>
  );
}
