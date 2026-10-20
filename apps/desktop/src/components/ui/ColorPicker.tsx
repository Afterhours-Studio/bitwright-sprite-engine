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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { Overlay, type OverlayAlign } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';

export interface ColorPickerProps {
  /** Accessible name of the swatch button. Always a translated string. */
  label: string;
  /** Current colour as '#rrggbb' (lower case). */
  value: string;
  /** Called with '#rrggbb' on every change, including while dragging. */
  onValueChange: (hex: string) => void;
  /** Accessible names. Always translated strings. */
  saturationLabel: string;
  hueLabel: string;
  hexLabel: string;
  /** Whether the control can be changed. */
  disabled?: boolean;
  /** Which edge of the swatch the panel lines up with. */
  align?: OverlayAlign;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/** Hue in degrees (0-360), saturation and value as fractions (0-1). */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/**
 * Reads a hex colour.
 *
 * @param hex - '#rrggbb' or 'rrggbb', in any case.
 * @returns The colour, or null when it is not six hex digits.
 */
export function hexToHsv(hex: string): Hsv | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null || match[1] === undefined) {
    return null;
  }
  const n = parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Writes a colour as hex.
 *
 * @param hsv - The colour.
 * @returns '#rrggbb' in lower case.
 */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number): number => {
    const k = (n + hue / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

type DragHandler = (event: React.PointerEvent<HTMLDivElement>) => void;

/**
 * A colour picker.
 *
 * Written rather than using `<input type="color">`, because that opens the
 * operating system's own dialog, which ignores the theme. This is a swatch that
 * opens a panel with a saturation/brightness square, a hue strip and a hex
 * field.
 *
 * The colour is held as hue, saturation and value so that the hue survives
 * while the colour passes through grey or black, where hex alone has forgotten
 * it.
 */
export function ColorPicker({
  label,
  value,
  onValueChange,
  saturationLabel,
  hueLabel,
  hexLabel,
  disabled = false,
  align,
  className,
}: ColorPickerProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [draft, setDraft] = useState(value);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  // Follow the value when it changes from outside, keeping the hue where the
  // new colour has none of its own.
  useEffect(() => {
    setDraft(value);
    setHsv((current) => {
      if (hsvToHex(current) === value.toLowerCase()) {
        return current;
      }
      const next = hexToHsv(value);
      if (next === null) {
        return current;
      }
      return next.s === 0 || next.v === 0 ? { ...next, h: current.h } : next;
    });
  }, [value]);

  const change = (next: Hsv): void => {
    setHsv(next);
    onValueChange(hsvToHex(next));
  };

  const commitDraft = (): void => {
    const parsed = hexToHsv(draft);
    if (parsed === null) {
      setDraft(value);
      return;
    }
    change(parsed);
    setDraft(hsvToHex(parsed));
  };

  const ratio = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: box.width === 0 ? 0 : clamp((event.clientX - box.left) / box.width, 0, 1),
      y: box.height === 0 ? 0 : clamp((event.clientY - box.top) / box.height, 0, 1),
    };
  };

  const dragSv: DragHandler = (event) => {
    const { x, y } = ratio(event);
    change({ h: hsv.h, s: x, v: 1 - y });
  };
  const dragHue: DragHandler = (event) => {
    change({ ...hsv, h: ratio(event).x * 360 });
  };

  const onSvKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = 0.01;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp(hsv.s - step, 0, 1) },
      ArrowRight: { s: clamp(hsv.s + step, 0, 1) },
      ArrowUp: { v: clamp(hsv.v + step, 0, 1) },
      ArrowDown: { v: clamp(hsv.v - step, 0, 1) },
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      change({ ...hsv, ...move });
    }
  };

  const onHueKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -10,
      PageUp: 10,
    };
    const delta = deltas[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      change({ ...hsv, h: clamp(hsv.h + delta, 0, 360) });
    }
  };

  /** Starts a drag: the pointer is captured so it can leave the strip. */
  const startDrag =
    (apply: DragHandler): DragHandler =>
    (event) => {
      const el = event.currentTarget;
      if (typeof el.setPointerCapture === 'function') {
        el.setPointerCapture(event.pointerId);
      }
      apply(event);
    };
  const moveDrag =
    (apply: DragHandler): DragHandler =>
    (event) => {
      if (event.buttons !== 0) {
        apply(event);
      }
    };

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const sPct = Math.round(hsv.s * 100);
  const vPct = Math.round(hsv.v * 100);

  return (
    <div
      ref={container}
      className={cn('relative inline-block', className)}
      onKeyDown={(event) => {
        // The dismiss hook closes on Escape; focus goes back to the swatch.
        if (event.key === 'Escape' && open) {
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((was) => !was);
        }}
        className={cn(
          'h-6 w-10 rounded-sm border border-line-input p-0.5',
          'transition-[border-color,transform] duration-150',
          'hover:border-line-strong active:scale-95',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
          open && 'border-line-focus',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="block h-full w-full rounded-[2px]" style={{ backgroundColor: value }} />
      </button>

      <Overlay open={open} {...(align === undefined ? {} : { align })} className="w-52 p-2">
        <div role="dialog" aria-label={label} className="flex flex-col gap-2">
          <div
            role="slider"
            tabIndex={0}
            aria-label={saturationLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sPct}
            aria-valuetext={`${sPct}%, ${vPct}%`}
            onPointerDown={startDrag(dragSv)}
            onPointerMove={moveDrag(dragSv)}
            onKeyDown={onSvKey}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus"
            style={{ backgroundColor: hueColor, backgroundImage: 'var(--picker-sv)' }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-float shadow-sm"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                backgroundColor: hsvToHex(hsv),
              }}
            />
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label={hueLabel}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onPointerDown={startDrag(dragHue)}
            onPointerMove={moveDrag(dragHue)}
            onKeyDown={onHueKey}
            className="relative h-3 w-full cursor-pointer touch-none rounded-pill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus"
            style={{ backgroundImage: 'var(--picker-hue)' }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-float shadow-sm"
              style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueColor }}
            />
          </div>

          <input
            type="text"
            aria-label={hexLabel}
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitDraft();
              }
            }}
            className="w-full rounded-sm border border-line-input bg-surface-input px-2 py-1 font-mono text-[11px] text-fg-primary transition-colors focus:border-line-focus focus:outline-none"
          />
        </div>
      </Overlay>
    </div>
  );
}
