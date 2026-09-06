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
  /** Shown when the list has entries but none match what was typed. */
  noMatchHint: string;
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
  noMatchHint,
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

  // True while the list is being browsed rather than searched. Filtering on
  // the value alone emptied the list the moment a whole identifier sat in the
  // field - nothing contains it but itself - so the list disappeared exactly
  // when it had just been used.
  const [browsing, setBrowsing] = useState(true);

  const needle = value.trim().toLowerCase();
  const matches = options.filter((option) => option.toLowerCase().includes(needle));
  const shown = browsing || needle === '' ? options : matches;

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
            setBrowsing(false);
            setOpen(true);
          }}
          onFocus={() => {
            setBrowsing(true);
            setOpen(true);
          }}
          onClick={() => {
            // A second press on an already focused field would otherwise do
            // nothing at all.
            setBrowsing(true);
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

        {/* The arrow says this is a list rather than a text field, and it
            opens the whole list rather than the filtered one: browsing is what
            an arrow means. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onClick={() => {
            setBrowsing(true);
            setOpen((was) => !was);
          }}
          className="absolute inset-y-0 end-0 flex items-center px-3"
        >
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
        </button>

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

        {/* Something is always said while the list is open. A panel that
            opens on nothing is indistinguishable from one that failed. */}
        <Overlay open={open && shown.length === 0} className="p-2">
          <p className="text-xs text-fg-secondary">
            {options.length === 0 ? emptyHint : noMatchHint}
          </p>
        </Overlay>
      </div>

      {hint !== undefined && <p className="text-xs text-fg-secondary">{hint}</p>}
    </div>
  );
}
