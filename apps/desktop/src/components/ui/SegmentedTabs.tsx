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
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { cn } from '@/lib/cn';

/** One tab. */
export interface Segment {
  value: string;
  label: string;
}

export interface SegmentedTabsProps {
  /** The tabs, in order. */
  segments: Segment[];
  /** The selected tab. */
  value: string;
  /** Accessible name for the group. Always a translated string. */
  label: string;
  /** Called with the newly selected tab. */
  onValueChange: (value: string) => void;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * A segmented control: one shared track, with the selection sliding between
 * positions rather than blinking from one to the next.
 *
 * The indicator is a single absolutely positioned element whose offset and
 * width are measured from the buttons, so it stays correct when a label is
 * translated into a longer language. Measuring is also why this holds state at
 * all: the geometry is not knowable until after layout.
 */
export function SegmentedTabs({
  segments,
  value,
  label,
  onValueChange,
  className,
}: SegmentedTabsProps): ReactElement {
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  const selected = segments.findIndex((segment) => segment.value === value);

  useEffect(() => {
    const measure = (): void => {
      const button = buttons.current[selected === -1 ? 0 : selected];
      const container = track.current;
      if (button === null || button === undefined || container === null) {
        return;
      }
      setIndicator({
        left: button.offsetLeft,
        width: button.offsetWidth,
        ready: true,
      });
    };

    measure();

    // A language change or a resize moves the labels, so the indicator has to
    // be measured again rather than kept from the first layout.
    const observer = new ResizeObserver(measure);
    if (track.current !== null) {
      observer.observe(track.current);
    }
    for (const button of buttons.current) {
      if (button !== null) {
        observer.observe(button);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, [selected, segments]);

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={label}
      className={cn(
        'relative inline-flex items-center gap-1 rounded-pill p-1',
        'border border-line-subtle bg-surface-content shadow-sm',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1 bottom-1 rounded-pill bg-accent',
          // Not animated until the first measurement, so it does not slide in
          // from the left edge on mount.
          indicator.ready && 'transition-[left,width] duration-200 ease-out',
        )}
        style={{
          left: `${String(indicator.left)}px`,
          width: `${String(indicator.width)}px`,
          opacity: indicator.ready ? 1 : 0,
        }}
      />

      {segments.map((segment, index) => (
        <button
          key={segment.value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="tab"
          aria-selected={segment.value === value}
          onClick={() => {
            onValueChange(segment.value);
          }}
          className={cn(
            'relative z-10 rounded-pill px-4 py-1.5 text-sm font-medium transition-colors',
            segment.value === value ? 'text-accent-fg' : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
