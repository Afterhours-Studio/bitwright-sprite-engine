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
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/ui/IconButton';
import { useToastText } from '@/hooks/useToastText';
import { cn } from '@/lib/cn';
import {
  useToastStore,
  type ToastAnchor,
  type ToastNotification,
  type ToastSeverity,
} from '@/stores/useToastStore';

/**
 * The severity colours.
 *
 * Written as arbitrary values reading the custom property directly, because
 * these four tokens are not in the Tailwind theme: that file is shared, and a
 * severity is a marker rather than a surface or a foreground, so it does not
 * belong in the surface model's own naming. The values themselves live in
 * `styles/tokens.css` beside every other colour, which is what keeps them in
 * the contrast check and following the theme.
 */
const TONE: Record<ToastSeverity, string> = {
  info: 'text-[color:var(--severity-info)]',
  success: 'text-[color:var(--severity-success)]',
  warning: 'text-[color:var(--severity-warning)]',
  error: 'text-[color:var(--severity-error)]',
};

/**
 * Where a toast grows from when the bell's position is not known.
 *
 * Its own corner nearest the dock, so the toast still swells into place rather
 * than appearing whole. Growing from `0 0` instead would send it flying in from
 * the window's top left, which is the one thing that reads as a bug rather than
 * as a missing refinement.
 */
const FALLBACK_ORIGIN = 'bottom right';

/**
 * Works out the transform origin for one toast.
 *
 * The bell is in the dock and the toast is in the layer above the content area,
 * so the two share nothing but the viewport. Both are therefore reduced to
 * viewport coordinates and the difference is taken, which is what
 * `transform-origin` wants: a point in the element's own box, measured from its
 * top left corner. The point is usually outside the box, which is allowed and
 * is exactly what makes the toast appear to come from somewhere else.
 *
 * @param rect - The toast's own box, untransformed.
 * @param anchor - The bell's centre, or null when it is not mounted.
 * @returns A `transform-origin` value.
 */
function originFor(rect: DOMRect, anchor: ToastAnchor | null): string {
  if (anchor === null) {
    return FALLBACK_ORIGIN;
  }
  return `${anchor.x - rect.left}px ${anchor.y - rect.top}px`;
}

export interface SeverityIconProps {
  /** Which icon to draw. */
  severity: ToastSeverity;
}

/**
 * The glyph that says how serious a notification is.
 *
 * Shape as well as colour, so severity survives a colour-blind reader and a
 * greyscale screenshot: a circle for information, a tick for success, a
 * triangle for a warning, a cross for an error. Stroked on a 16 unit grid in
 * `currentColor`, like every other icon in the application, with the severity
 * token supplied by the wrapper.
 */
export function SeverityIcon({ severity }: SeverityIconProps): ReactElement {
  return (
    <span
      className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center', TONE[severity])}
    >
      {severity === 'info' && (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.85" fill="currentColor" />
        </svg>
      )}
      {severity === 'success' && (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M5.2 8.3l2 2 3.6-4.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {severity === 'warning' && (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
          <path
            d="M8 2.2l5.9 10.2a.9.9 0 0 1-.8 1.3H2.9a.9.9 0 0 1-.8-1.3z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M8 6.4v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="0.85" fill="currentColor" />
        </svg>
      )}
      {severity === 'error' && (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

/** The cross on the dismiss button. */
function CloseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
      <path
        d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface ToastProps {
  /** The notification to draw. */
  toast: ToastNotification;
}

/**
 * One toast: a floating card that grows out of the notification bell and
 * shrinks back into it.
 *
 * THE ANIMATION, AND WHY IT IS BUILT THE WAY IT IS
 *
 * A new toast scales up from the bell's position in the dock and settles into
 * its slot in the stack; dismissing runs the same transition backwards, so it
 * appears to fly back into the bell it will be found in afterwards. That is one
 * CSS transition on `transform` and `opacity`, with `transform-origin` set to
 * the bell's point in this element's own coordinates. There is no animation
 * loop: the only JavaScript involved measures a rectangle and flips a boolean,
 * and the browser does the rest. That matters because the global stylesheet
 * neutralises transition durations under `prefers-reduced-motion`, and a script
 * driving the transform frame by frame would sail straight past that.
 *
 * THREE ELEMENTS, EACH WITH ONE JOB
 *
 *   the row     a one-row grid whose track goes from `1fr` to `0fr` while the
 *               toast leaves. That is what makes the stack close the gap
 *               smoothly instead of the toasts above dropping into the hole the
 *               moment this one unmounts. A plain height cannot be transitioned
 *               to or from `auto`; a grid track can.
 *   the frame   the measuring box. It is never transformed, so its rectangle is
 *               the toast's real position on screen, which is what the
 *               transform origin is worked out from.
 *   the card    the thing that actually moves.
 *
 * NOTHING CLIPS, AND THE EXIT IS IN TWO HALVES
 *
 * A collapsing row normally has to clip, or the content refuses to shrink with
 * it. Clipping here would cut the exit in half, because a card scaling towards
 * the bell leaves its own slot almost immediately. So the row does not clip;
 * it waits instead. The card fades and flies back into the bell over the first
 * two hundred milliseconds with the stack completely still, and only then does
 * the track close the gap, over the second two hundred, by which time the card
 * is transparent and it no longer matters that it is hanging outside its slot.
 * That is what `delay-200` on the row buys, and it is why `EXIT_MS` is the sum
 * of the two and not the length of one.
 *
 * The origin is recomputed on every render rather than remembered. The stack
 * reflows when a toast above this one is dismissed, the dock moves the bell
 * when its chips expand, and the window resizes; all three change the answer,
 * and all three re-render this component because the anchor and the list both
 * live in the store. It is a single `getBoundingClientRect` on a stack of at
 * most three.
 */
export function Toast({ toast }: ToastProps): ReactElement {
  const { t } = useTranslation();
  const text = useToastText();
  const dismiss = useToastStore((state) => state.dismiss);
  const pause = useToastStore((state) => state.pause);
  const resume = useToastStore((state) => state.resume);
  const bellAnchor = useToastStore((state) => state.bellAnchor);

  const frame = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  // No dependency list on purpose: see the note above. Writing the origin
  // straight onto the node rather than through state is what makes that safe,
  // because measuring cannot then schedule the render that measures again.
  useLayoutEffect(() => {
    const box = frame.current;
    const node = card.current;
    if (box === null || node === null) {
      return;
    }
    node.style.transformOrigin = originFor(box.getBoundingClientRect(), bellAnchor);
  });

  useEffect(() => {
    // One frame, and not a loop. The card has to be painted small before the
    // class that grows it is applied, or the browser sees a single style change
    // and there is nothing to transition between.
    const handle = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, []);

  const title = toast.titleKey === null ? null : text(toast.titleKey, toast.values);
  const message = text(toast.messageKey, toast.values);
  const settled = entered && !toast.leaving;

  return (
    <li
      data-leaving={toast.leaving}
      className={cn(
        'grid grid-rows-[1fr] transition-[grid-template-rows] delay-200 duration-200 ease-out',
        'data-[leaving=true]:grid-rows-[0fr]',
      )}
    >
      {/* `min-h-0` is not decoration. A grid item's automatic minimum size is
          its content, so without this the track would refuse to go below the
          toast's height and `0fr` would do nothing at all. */}
      <div ref={frame} className="min-h-0">
        <div
          ref={card}
          className={cn(
            'pb-2 transition-[opacity,transform] duration-200 ease-out',
            settled ? 'scale-100 opacity-100' : 'scale-[0.3] opacity-0',
            // A toast on its way out must not still be catching clicks meant
            // for the one behind it, and for the second half of its exit it is
            // invisible and lying outside its own slot.
            toast.leaving && 'pointer-events-none',
          )}
        >
          <div
            // `alert` is assertive and interrupts whatever the screen reader is
            // saying; `status` is polite and waits its turn. An error has
            // earned the interruption and a success has not. Neither takes
            // focus: a toast that stole it would move the caret out of the
            // field the user is typing in, and an auto-dismissing one would
            // then drop focus on the floor when it went.
            role={toast.severity === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
            onPointerEnter={() => {
              pause(toast.id);
            }}
            onPointerLeave={() => {
              resume(toast.id);
            }}
            // Focus counts as reading it, too. A keyboard user who has tabbed
            // to the dismiss button is looking at the toast, and it timing out
            // under them would move the button they are about to press.
            onFocus={() => {
              pause(toast.id);
            }}
            onBlur={() => {
              resume(toast.id);
            }}
            className={cn(
              'flex w-[336px] items-start gap-3 rounded-md p-3',
              'border border-line bg-surface-float shadow-md',
            )}
          >
            <SeverityIcon severity={toast.severity} />

            <div className="min-w-0 flex-1">
              {title !== null && (
                <p className="text-sm font-medium leading-snug text-fg-primary">{title}</p>
              )}
              <p
                className={cn(
                  'break-words text-sm leading-snug',
                  title === null ? 'text-fg-primary' : 'mt-1 text-fg-secondary',
                )}
              >
                {message}
              </p>
            </div>

            <IconButton
              label={t('notifications.dismiss')}
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>
      </div>
    </li>
  );
}
