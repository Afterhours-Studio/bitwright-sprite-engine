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
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactElement,
} from 'react';

import { cn } from '@/lib/cn';

/** Which side of the trigger the label appears on. */
export type TooltipSide = 'top' | 'bottom';

export interface TooltipProps {
  /** The text shown. Always a translated string. */
  label: string;
  /** Which side of the trigger it appears on. */
  side?: TooltipSide;
  /** The trigger. Exactly one element. */
  children: ReactElement;
}

/**
 * How long the pointer rests on the trigger before the label appears.
 *
 * Long enough that sweeping across a row of icon buttons does not flash a
 * label under every one of them, short enough to answer a question the user is
 * already asking. Closing is not delayed at all, because a label that lingers
 * is a label in the way.
 */
const OPEN_DELAY_MS = 400;

/**
 * Where the label sits, and the corner it grows from.
 *
 * `top` is a real position rather than a mirrored class name: the dock sits at
 * the bottom of the window, so a label below one of its buttons would be off
 * screen rather than merely misplaced.
 */
const SIDE: Record<TooltipSide, string> = {
  top: 'bottom-[calc(100%+6px)] origin-bottom',
  bottom: 'top-[calc(100%+6px)] origin-top',
};

/**
 * Whether a focus came from the keyboard.
 *
 * A pointer press focuses a button as well, and opening there would put the
 * label straight back over the control the press just hit. `:focus-visible` is
 * the browser's own answer to that question, and it accounts for the cases a
 * hand rolled "was the last input a key" flag gets wrong.
 *
 * @param element - The element that received focus.
 * @returns Whether the focus should show the label.
 */
function keyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    // An engine without the selector, and jsdom. Showing the label is the
    // safer failure: appearing once too often is a smaller problem than an
    // icon button a keyboard user cannot identify.
    return true;
  }
}

/**
 * A small floating label for a control that carries no text of its own.
 *
 * This exists because the native `title` attribute is drawn by the operating
 * system: its font, colours, corners, and its second-long delay are all
 * outside the theme, and none of them can be configured.
 *
 * Shown on hover after a delay and on keyboard focus immediately. Keyboard
 * focus is not a nicety here; an icon button with no visible label is
 * unusable without it. It hides on Escape and on pointer down, so it is never
 * left covering the thing that was just clicked, and a pending open is
 * cancelled if the pointer leaves first.
 *
 * WRAPPER SHAPE. The wrapper is an `inline-flex` box that does not shrink,
 * holding an absolutely positioned label. That is the one shape which leaves
 * the trigger's own layout box alone: it adds no width, and it keeps the
 * `shrink-0` behaviour an icon button already had, so a caller sizing its
 * buttons with flex, or magnifying them on hover with a transform, gets what
 * it had before the wrapper existed.
 *
 * DRAG REGIONS. The title bar drags the window through
 * `data-tauri-drag-region`, and its controls opt out with `.no-drag`. The
 * wrapper carries neither, so it is transparent to both: it does not restart a
 * drag region its parent turned off, and it never claims one of its own. The
 * label itself takes no pointer events at all.
 *
 * The label stays mounted while closed, and hides by opacity, so that
 * dismissing transitions rather than snapping. Reduced motion is handled by
 * the global stylesheet, which neutralises transition durations, so this uses
 * a CSS transition rather than animating in JavaScript.
 */
export function Tooltip({ label, side = 'bottom', children }: TooltipProps): ReactElement {
  const id = useId();
  const [showing, setShowing] = useState(false);
  const timer = useRef<number | null>(null);

  const wrapper = useRef<HTMLSpanElement>(null);

  // Whether the focus about to arrive was caused by a press on the trigger.
  // `:focus-visible` already answers that in every engine that implements it;
  // this is what answers it in one that does not, where the check below has to
  // fall back to treating a focus as a keyboard focus.
  const pressed = useRef(false);

  const cancel = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback((): void => {
    cancel();
    setShowing(false);
  }, [cancel]);

  /**
   * Whether the trigger currently has a panel of its own open.
   *
   * A control that opens a menu, a popover or a listbox renders that panel
   * inside this wrapper, so moving the pointer onto an item in the panel is a
   * pointer entering the wrapper, and that is what was putting the trigger's
   * one-word label back on screen over the menu it belongs to. Such a trigger
   * also keeps focus while its panel is open, which reaches the same end
   * through the focus rule.
   *
   * Read from the DOM rather than from the child's props: the flag belongs to
   * whichever element actually opens the panel, and that is often a button
   * nested inside the component passed here, where a props check finds
   * nothing. Every one of these controls has to declare `aria-expanded` for
   * assistive technology anyway, so the DOM always carries the answer.
   */
  const panelOpen = useCallback(
    (): boolean => wrapper.current?.querySelector('[aria-expanded="true"]') != null,
    [],
  );

  const schedule = useCallback((): void => {
    cancel();
    if (panelOpen()) {
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      // Checked again on firing, not only on scheduling: the panel may have
      // opened during the delay, which is exactly what a press does.
      setShowing(!panelOpen());
    }, OPEN_DELAY_MS);
  }, [cancel, panelOpen]);

  const onFocus = useCallback(
    (event: FocusEvent<HTMLSpanElement>): void => {
      if (!pressed.current && !panelOpen() && keyboardFocus(event.target)) {
        cancel();
        setShowing(true);
      }
    },
    [cancel, panelOpen],
  );

  const onPointerDown = useCallback((): void => {
    pressed.current = true;
    hide();
  }, [hide]);

  const onPointerLeave = useCallback((): void => {
    pressed.current = false;
    hide();
  }, [hide]);

  const onBlur = useCallback((): void => {
    pressed.current = false;
    hide();
  }, [hide]);

  // Escape and a press anywhere both close it. The press is watched on the
  // document, in the capture phase, so that the label is gone before whatever
  // was pressed reacts. A press on the trigger itself is handled on the
  // wrapper instead, because that one has to cancel a pending open as well,
  // and at that point these listeners are not attached yet.
  useEffect(() => {
    if (!showing) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        hide();
      }
    };

    const onPressAnywhere = (): void => {
      hide();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPressAnywhere, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPressAnywhere, true);
    };
  }, [showing, hide]);

  // A trigger unmounted while its open is pending would otherwise leave a
  // timer that sets state on a component that is gone.
  useEffect(
    () => () => {
      cancel();
    },
    [cancel],
  );

  // The description is attached only while the label is showing. Referenced
  // permanently it would read out on every focus, doubling an icon button's
  // own `aria-label`, which is where its accessible name already comes from.
  const trigger = showing ? cloneElement(children, { 'aria-describedby': id }) : children;

  return (
    <span
      ref={wrapper}
      className="relative inline-flex shrink-0"
      onPointerEnter={schedule}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {trigger}
      <span
        id={id}
        role="tooltip"
        aria-hidden={!showing}
        className={cn(
          'pointer-events-none absolute start-1/2 z-50 -translate-x-1/2 whitespace-nowrap',
          'rounded-sm border border-line bg-surface-float px-2 py-1 shadow-md',
          'text-xs font-medium text-fg-primary',
          'transition-[opacity,transform] duration-150',
          SIDE[side],
          showing ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
