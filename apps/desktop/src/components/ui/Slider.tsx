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
import { useState, type ReactElement } from 'react';

import { cn } from '@/lib/cn';

export interface SliderProps {
  /** Accessible name. Always a translated string. Not drawn: callers show their own text. */
  label: string;
  /** Current value. */
  value: number;
  /** Lowest value. */
  min: number;
  /** Highest value. */
  max: number;
  /** Default 1. */
  step?: number;
  /** Called on every change, including while dragging. Already clamped and snapped. */
  onValueChange: (value: number) => void;
  /** Whether the control can be changed. */
  disabled?: boolean;
  /** Extra classes for layout only (e.g. width), never colour. */
  className?: string;
}

/**
 * Clamps to [min, max] and snaps to min + k * step.
 *
 * The rounding at the end removes float noise: for a step of 0.1 the sum of
 * min and a multiple of step lands on 0.30000000000000004, and a caller that
 * compares or prints the value would see it. Ten decimal places is far beyond
 * anything a slider can express and well inside the reach of `Number`.
 */
export function snap(value: number, min: number, max: number, step: number): number {
  const size = step > 0 ? step : 1;
  const stepped = min + Math.round((value - min) / size) * size;
  const clamped = Math.min(max, Math.max(min, stepped));
  return Math.round(clamped * 1e10) / 1e10;
}

/**
 * A slider.
 *
 * Written rather than using `<input type="range">`, for the same reason as the
 * dropdown: the native track and thumb are drawn by the platform, so they keep
 * their own colours and corners and sit as a grey bar in the middle of a
 * themed interface.
 *
 * The value is a plain number the caller owns, and every change is clamped and
 * snapped before it is handed back, so a caller never has to tidy up after a
 * drag. The fill and the thumb are positioned without a transition: they have
 * to stay under the pointer, and an animated one would trail behind it.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  disabled = false,
  className,
}: SliderProps): ReactElement {
  const [dragging, setDragging] = useState(false);

  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;

  const commit = (next: number): void => {
    const snapped = snap(next, min, max, step);
    if (snapped !== value) {
      onValueChange(snapped);
    }
  };

  const trackPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) {
      return;
    }
    const ratio = (event.clientX - box.left) / box.width;
    commit(min + ratio * (max - min));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    // Capture keeps the drag alive once the pointer leaves the track. jsdom
    // has no such method on an element, so it is only called when it is there.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragging(true);
    trackPointer(event);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || !dragging) {
      return;
    }
    trackPointer(event);
  };

  const onPointerUp = (): void => {
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - step;
        break;
      case 'PageUp':
        next = value + step * 10;
        break;
      case 'PageDown':
        next = value - step * 10;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }

    event.preventDefault();
    commit(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-4 w-full touch-none select-none items-center rounded-pill',
        'focus-visible:outline-none',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative h-1 w-full overflow-hidden rounded-pill bg-surface-well">
        <span
          className="absolute inset-y-0 start-0 rounded-pill bg-accent"
          style={{ width: `${pct}%` }}
        />
      </span>

      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full',
          'border border-accent bg-accent-fg shadow-sm transition-transform duration-150',
          dragging ? 'scale-125' : 'group-hover:scale-125 group-focus-visible:scale-125',
        )}
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
