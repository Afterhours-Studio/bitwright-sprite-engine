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
  useCallback,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Tooltip } from '@/components/ui/Tooltip';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';

/**
 * THE SHAPE EVERY BUTTON IN THE DOCK IS CUT FROM.
 *
 * Written once, because there are two things that expand from an icon into an
 * icon and a label - an open popover entry, and the chosen item of the tool
 * cluster - and padding written twice is padding that drifts apart. It already
 * had: the expanded chip read as off centre, with the icon closer to its end
 * of the pill than the label was to the other.
 *
 * THE PADDING IS DELIBERATELY UNEVEN, AND THAT IS WHAT MAKES IT LOOK EVEN.
 * A pill's ends are semicircles as wide as the chip is tall, so both the icon
 * and the label sit inside a curve rather than beside a straight edge. The
 * icon is a full height square whose corners run at the tightest part of that
 * curve; the label is short, centred, and sits where the curve is at its
 * widest. Equal padding therefore leaves the icon visibly the tighter of the
 * two. The leading side gets 14px against the trailing side's 12px, which is
 * what brings the two back to looking the same.
 *
 * THE SPACE BETWEEN THE ICON AND THE LABEL IS A FLEX GAP THAT GOES TO ZERO,
 * not padding on the label. Padding was tried, on the reasoning that it would
 * be clipped away with the label it belonged to. It is not: a grid track's
 * automatic minimum is the item's minimum contribution, and `min-width: 0`
 * zeroes the text in that contribution but never the item's own padding. Every
 * collapsed chip therefore measured 42px rather than 34, carrying 8px of
 * invisible label on its trailing edge, which put the icon 4px left of the
 * chip's centre and the tooltip - centred on the chip, correctly - 4px right
 * of the icon it was naming. A gap is nothing when it is `gap-0`.
 *
 * NOTHING HERE TRANSITIONS `transform`, AND THAT IS DELIBERATE. Expanding is a
 * horizontal change: the padding and the label's track both grow sideways at a
 * fixed `h-8`, so the chip never moves up or down. A scale on the chip would,
 * and did - the magnify ran on the whole button, so pressing one made it drop
 * out of its hover size and the chip appeared to hop. The magnify now lives on
 * the icon, where it cannot move the chip at all.
 */
const CHIP = cn(
  'group inline-flex h-8 shrink-0 items-center rounded-pill border text-sm font-medium',
  'transition-[background-color,border-color,color,padding,gap] duration-150',
);

/**
 * The chip holding a lone icon: square, and even on both sides.
 *
 * Seven pixels, not eight, because the border is inside the 32px height but
 * adds to a width that is decided by the content. Seven plus the one pixel
 * border is the same eight pixel inset the rest of the bar uses, and it makes
 * the chip exactly as wide as it is tall, which is what puts the icon on the
 * chip's centre line and the tooltip directly under it.
 */
const CHIP_COLLAPSED = 'gap-0 px-[7px]';

/** The chip holding an icon and a label. See the note on CHIP for the 14/12. */
const CHIP_EXPANDED = 'gap-2 ps-3.5 pe-3';

/**
 * The chip whose face is words rather than an icon.
 *
 * Even on both ends, unlike CHIP_EXPANDED. The 14/12 there corrects for a
 * full height square icon crowding the pill's leading cap; text is short and
 * centred and sits where the cap is at its widest, so both ends of a text
 * face want the same number.
 */
const CHIP_TEXT = 'gap-2 px-3';

/** How a chip that is not the current one reads when it is not being used. */
const CHIP_QUIET = 'border-transparent text-fg-secondary hover:text-fg-primary';

/** The chip marking a transient state, such as an open popover. */
const CHIP_OPEN = 'border-line bg-surface-content-alt text-fg-primary';

/**
 * The chip marking a standing choice.
 *
 * The accent, which is what marks the active state everywhere else in the
 * chrome: the selected tab in the title bar and the Generate pill on this same
 * bar. The anchor was tried here first and rejected on sight - a near black
 * chip on a light float bar reads as a hole punched in the dock, which is the
 * exact look the dock was rebuilt to get rid of.
 *
 * An open popover takes the neutral chip instead, so a choice that stays and a
 * panel that happens to be showing never look like the same thing.
 */
const CHIP_CHOSEN = 'border-transparent bg-accent text-accent-fg';

/**
 * The chrome every floating bar in the row shares.
 *
 * The dock and the rails beside it share their border, surface and shadow. A
 * rail that styled itself would drift from the dock the first time either
 * changed.
 *
 * Their corners differ deliberately. The dock is a pill because it is a strip
 * of pill shaped chips. A rail sits directly beneath a corner of the card
 * above it, close enough that the two curves are read as a pair, so it takes
 * that card's radius instead: a full pill under a 14px corner reads as two
 * things that were meant to match and do not.
 */
const DOCK_BAR = cn(
  'pointer-events-auto flex items-center gap-1 rounded-pill',
  'border border-line bg-surface-float px-2 py-1 text-fg-primary shadow-lg',
);

/**
 * A rail, which is a bar holding a single control.
 *
 * No padding, unlike the dock. The dock's padding is what separates its chips
 * from its own edge, but a rail has one child filling it, so the same padding
 * leaves a ring of bar showing around a chip that is already the same shape.
 * Two rounded outlines a couple of pixels apart do not read as a border; they
 * read as a mistake, which is exactly how it was reported.
 *
 * The chip inside therefore becomes the visible shape, and the rail supplies
 * only the surface, the border and the shadow that hold it off the canvas.
 */
const DOCK_RAIL = cn(
  'pointer-events-auto flex items-center rounded-lg',
  'border border-line bg-surface-float text-fg-primary shadow-lg',
  // The control fills the rail, so the pair is one shape and one height. 40
  // plus the border matches the dock's 8px chip inside 1px of padding, which
  // is what puts all three bars on the same line rather than merely near it.
  '[&_button]:h-10 [&_button]:rounded-lg',
);

export interface DockProps {
  /** The entries. Each one opens something; none of them act. */
  children: ReactNode;
  /** A cluster of choices, held apart on the bar's leading edge. */
  cluster?: ReactNode;
  /** The screen's single action, held apart on the bar's trailing edge. */
  action?: ReactNode;
  /** A separate bar at the leading end of the row. */
  leadingRail?: ReactNode;
  /** A separate bar at the trailing end of the row. */
  trailingRail?: ReactNode;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * The floating strip of shortcuts for the current screen.
 *
 * THE DOCK CHOOSES AND OPENS. IT DOES NOT ACT.
 *
 * Everything in `cluster` is a choice and everything in `children` opens a
 * popover. An always-visible bar is the easiest thing on screen to hit by
 * accident, so a one-press irreversible action does not belong in it. An
 * earlier version had a button that overwrote the seed the user had typed, and
 * another that wiped the prompt, the parameters and the results, both on a
 * single press with no way back. Randomising now lives inside the seed
 * popover, where it is a decision; resetting lives behind a confirm.
 *
 * `action` is the one exception, and it is separated structurally as well as
 * visually: a hairline, then the accent pill. A screen passes at most one.
 *
 * It is a strip rather than a slab. The bar is its content plus four pixels,
 * so the height comes from the 32 pixel chips inside it and the padding never
 * doubles as a design element of its own.
 *
 * The bar sits on --surface-float, which is what it is: a layer floating above
 * the content. It carries the ordinary foreground tokens. It used to sit on
 * --surface-anchor, a near-black slab used nowhere else in the application,
 * which read as a control panel borrowed from another product.
 *
 * A screen with no shortcuts renders no dock. Gallery and Settings have none,
 * and an empty bar on those screens was pure furniture.
 *
 * THE ROW IS THREE COLUMNS, NOT A FLEX ROW WITH SPACE BETWEEN.
 *
 * The dock is centred on the window, and it has to stay centred whatever the
 * rails beside it are showing. `justify-between` would centre it on the space
 * the rails left over instead, so the whole bar would slide sideways every
 * time a rail changed width - which the notification badge and the run pill
 * both do, while the user is looking at them. Two outer columns of equal width
 * hold the middle one still. They are `minmax(0, 1fr)` rather than `1fr` so a
 * rail shrinks rather than shoving the dock off centre.
 */
export function Dock({
  children,
  cluster,
  action,
  leadingRail,
  trailingRail,
  className,
}: DockProps): ReactElement {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-3 grid items-end gap-2 px-3',
        'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
      )}
    >
      <div className="flex justify-start">
        {leadingRail !== undefined && <div className={DOCK_RAIL}>{leadingRail}</div>}
      </div>

      <div className={cn(DOCK_BAR, 'max-w-full', className)}>
        {cluster !== undefined && (
          <>
            {cluster}
            <DockRule />
          </>
        )}

        {children}

        {action !== undefined && (
          <>
            <DockRule />
            {action}
          </>
        )}
      </div>

      <div className="flex justify-end">
        {trailingRail !== undefined && <div className={DOCK_RAIL}>{trailingRail}</div>}
      </div>
    </div>
  );
}

/** The hairline between two regions of the bar. */
function DockRule(): ReactElement {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />;
}

export interface ChipContentProps {
  /** The name. Always a translated string. */
  label: string;
  /** The icon, shown in every state. */
  icon: ReactNode;
  /** Whether the label is showing beside the icon. */
  expanded: boolean;
  /** Whether the icon answers the pointer and the keyboard by growing. */
  magnify: boolean;
}

/**
 * The inside of a chip: an icon, and a label that slides out beside it.
 *
 * THE LABEL IS NOT MOUNTED AND UNMOUNTED, because that snaps. It sits in a
 * single column grid whose track goes from `0fr` to `1fr`, which is the one
 * way to transition a box between no width and the width of its contents; a
 * plain `width` cannot animate to `auto`. The track's automatic minimum is
 * min-content, so the label itself carries `min-w-0` or it would never
 * collapse.
 *
 * BOTH SIT ON THE SAME CENTRE LINE. The track stretches to the chip's full
 * height and centres the label inside it, rather than being as tall as one
 * line of text and relying on the chip to place that box. `leading-none` is
 * what makes the centring land on the letters: a 1.5 line height wraps the
 * glyphs in half-leading that is not shared evenly between an ascender and a
 * descender, and the text ends up sitting low beside the icon. Stretching the
 * track also leaves the Vietnamese stacked diacritics, in a word such as
 * "Kích thước", somewhere to go: the track clips, and a line box cut to the
 * font size would have clipped them off.
 *
 * The label carries no padding of its own. Padding on a grid item is part of
 * that item's minimum contribution and survives a `0fr` track whatever its
 * `min-width` says, so a leading pad here would be 8px of dead width on every
 * collapsed chip. The space between icon and label is a gap on the chip
 * instead, and the chip sets it to zero when there is no label. See CHIP.
 *
 * The magnify is on the icon rather than on the chip, so that growing it moves
 * nothing: the icon's box stays 16 pixels whatever the transform does to what
 * is drawn inside it.
 *
 * Reduced motion is handled globally, where transition durations are
 * neutralised, so both of these are CSS transitions and not a script.
 */
function ChipContent({ label, icon, expanded, magnify }: ChipContentProps): ReactElement {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center',
          'transition-transform duration-150',
          magnify && 'group-hover:scale-125 group-focus-visible:scale-125',
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'grid self-stretch overflow-hidden transition-[grid-template-columns] duration-150',
          expanded ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]',
        )}
      >
        <span className="flex min-w-0 items-center whitespace-nowrap leading-none">{label}</span>
      </span>
    </>
  );
}

/** Which edge of its trigger a panel lines up with. */
export type DockPanelAlign = 'start' | 'center' | 'end';

/**
 * Where a panel sits, and the corner it grows from.
 *
 * `start` and `end` exist for the rails. A panel centred on a control near
 * either edge of the window hangs half of itself off the screen; aligned to
 * that edge it opens inwards, over the window it belongs to.
 *
 * Each of the three sets exactly one inset and lets the width come from the
 * panel. An absolutely positioned box given a start, an end and a width is
 * over-constrained, and the resolution is not a compromise: one inset wins and
 * the other is discarded, which is how a panel ends up hanging off the screen
 * while the classes read as though it could not.
 */
const PANEL_ALIGN: Record<DockPanelAlign, string> = {
  start: 'start-0 origin-bottom-left',
  center: 'start-1/2 -translate-x-1/2 origin-bottom',
  end: 'end-0 origin-bottom-right',
};

interface DockPanelProps {
  /** Ties the panel to the control that opens it. */
  id: string;
  /** Accessible name for the panel. Always a translated string. */
  label: string;
  /** Whether the panel is showing. */
  open: boolean;
  /** Which edge of the trigger to line up with. */
  align?: DockPanelAlign;
  /**
   * The panel's width, as a class.
   *
   * A slot of its own rather than something a `className` overrides, and the
   * same for the padding below. `cn` joins class names, it does not merge
   * them, so a caller passing `w-auto` beside the default `w-72` would leave
   * both in the attribute and hand the decision to the stylesheet's own
   * ordering. One slot can only hold one answer.
   */
  width?: string;
  /** The panel's padding, as a class. See the note on `width`. */
  padding?: string;
  /** The panel's contents. */
  children: ReactNode;
}

/**
 * The floating panel a dock control opens.
 *
 * Shared, because two controls open one - an entry, and a choice that carries a
 * flyout - and a panel written twice is a panel that drifts. The dock is itself
 * a float surface, so the panel is held apart from it by its border rather than
 * by a change of surface. That is the mechanism the design system declares for
 * light mode, where every content surface is the same white.
 *
 * It stays mounted while closed and hides by opacity, so that dismissing
 * transitions rather than snapping. `inert` keeps it out of the accessibility
 * tree and out of tab order meanwhile, without taking it out of the layout and
 * losing the transition.
 */
function DockPanel({
  id,
  label,
  open,
  align = 'center',
  width = 'w-72',
  padding = 'p-3',
  children,
}: DockPanelProps): ReactElement {
  return (
    <div
      id={id}
      role="dialog"
      aria-label={label}
      aria-hidden={!open}
      className={cn(
        'absolute bottom-[calc(100%+10px)] z-50',
        PANEL_ALIGN[align],
        width,
        padding,
        'rounded-md border border-line bg-surface-float shadow-md',
        'transition-[opacity,transform] duration-150',
        open
          ? 'pointer-events-auto scale-100 opacity-100'
          : 'pointer-events-none scale-95 opacity-0',
      )}
      {...(open ? {} : { inert: '' })}
    >
      {children}
    </div>
  );
}

/** A flyout a choice opens as well as selecting itself. */
export interface DockChoicePopover {
  /** Accessible name for the panel. Always a translated string. */
  label: string;
  /** The panel's contents, given the means to close it. */
  render: (close: () => void) => ReactNode;
}

/** One choice in a dock cluster. */
export interface DockChoice<T extends string> {
  /** Stable identifier, returned to the caller. */
  value: T;
  /** Name. Always a translated string. */
  label: string;
  /** The icon. */
  icon: ReactNode;
  /**
   * A flyout of variants this choice opens as well as selecting itself.
   *
   * For a choice that is really one tool with settings, such as the shape tool
   * and which outline it lays down. Without this a cluster needs two controls
   * for one thing: the tool, and a separate button to configure it.
   */
  popover?: DockChoicePopover;
}

export interface DockChoicesProps<T extends string> {
  /** The choices, in order. */
  choices: readonly DockChoice<T>[];
  /** The chosen one. Exactly one of `choices` is always chosen. */
  value: T;
  /** Accessible name for the group. Always a translated string. */
  label: string;
  /** Called with the new choice. */
  onValueChange: (value: T) => void;
}

/**
 * A cluster of mutually exclusive choices, where the chosen one is expanded.
 *
 * A radio group, not a row of toggles: one of them is always on, and pressing
 * one does not turn the others off so much as move the selection. That is also
 * why it reads the way it does - the chosen item is the only one showing its
 * name, so the cluster states what is selected without a label of its own and
 * without asking the user to hover every icon to find out.
 *
 * Nothing here acts. Choosing changes what the next thing the user does will
 * do, which is reversible by choosing again, so it belongs in a bar in a way
 * that a one-press command does not.
 *
 * Keyboard: one tab stop for the whole cluster, landing on the chosen item,
 * and the arrow keys move the choice from there. That is what a radio group
 * does, and it is why a cluster of six does not cost six tab stops on the way
 * to everything else in the dock.
 */
export function DockChoices<T extends string>({
  choices,
  value,
  label,
  onValueChange,
}: DockChoicesProps<T>): ReactElement {
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);

  const selected = choices.findIndex((choice) => choice.value === value);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  const move = (delta: number): void => {
    if (choices.length === 0) {
      return;
    }
    const from = selected === -1 ? 0 : selected;
    const index = (from + delta + choices.length) % choices.length;
    const choice = choices[index];
    if (choice === undefined) {
      return;
    }
    // Arrowing along the cluster moves the choice but opens nothing. Spawning
    // a panel under a key that is being held down to browse would put one in
    // the way of the next press.
    setOpen(false);
    onValueChange(choice.value);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Escape':
        if (open) {
          // Closing makes the panel inert, so focus goes back to the chip that
          // opened it rather than being dropped on the document body.
          setOpen(false);
          buttons.current[selected]?.focus();
        }
        break;
      default:
        break;
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    // Tabbing out of the cluster puts the flyout away. A null relatedTarget is
    // left alone: that is a press on a part of the panel that cannot take
    // focus, which is not the user leaving.
    const next = event.relatedTarget;
    if (next !== null && container.current?.contains(next) !== true) {
      setOpen(false);
    }
  };

  return (
    <div
      ref={container}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="flex items-center gap-1"
    >
      {choices.map((choice, index) => {
        const chosen = choice.value === value;
        const popover = choice.popover;

        return (
          <div key={choice.value} className="relative inline-flex shrink-0">
            <Tooltip label={choice.label} side="top">
              <button
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={choice.label}
                tabIndex={chosen ? 0 : -1}
                // aria-expanded is not among the states role="radio" formally
                // supports, and it is declared anyway: the tooltip stays down
                // while a trigger reports itself expanded, so without it this
                // chip's label would sit on top of the flyout it just opened.
                // A state a screen reader may ignore is a smaller cost than a
                // label covering the panel for everyone.
                {...(popover === undefined
                  ? {}
                  : {
                      'aria-haspopup': 'dialog' as const,
                      'aria-controls': panelId,
                      'aria-expanded': open && chosen,
                    })}
                onClick={() => {
                  onValueChange(choice.value);
                  // Pressing a choice that carries a flyout selects it and
                  // shows the flyout on the same press; pressing it again puts
                  // the flyout away. One sentence, and it does not depend on
                  // which of the two the user was after. Pressing any other
                  // choice puts an open flyout away.
                  setOpen(popover !== undefined && !(open && chosen));
                }}
                className={cn(
                  CHIP,
                  chosen ? cn(CHIP_EXPANDED, CHIP_CHOSEN) : cn(CHIP_COLLAPSED, CHIP_QUIET),
                )}
              >
                <ChipContent
                  label={choice.label}
                  icon={choice.icon}
                  expanded={chosen}
                  magnify={!chosen}
                />
              </button>
            </Tooltip>

            {popover !== undefined && (
              <DockPanel id={panelId} label={popover.label} open={open && chosen}>
                {popover.render(close)}
              </DockPanel>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface DockEntryProps {
  /** The entry's name. Always a translated string. */
  label: string;
  /** The icon, shown in every state. */
  icon: ReactNode;
  /**
   * Which edge of the entry its panel lines up with.
   *
   * `end` for an entry sitting at the trailing end of the bar. A 288px panel
   * centred on the last chip hangs off the window: measured at the 960px
   * minimum width, the trailing entry's panel ran 11px past the edge in
   * English and 21px in Vietnamese, where a longer chosen tool label pushes
   * the bar further across.
   */
  align?: DockPanelAlign;
  /** The popover's contents, given the means to close it. */
  children: (close: () => void) => ReactNode;
}

/**
 * One entry: an icon that opens a popover, and never acts on its own press.
 *
 * A closed entry is an icon alone, which is why it carries the tooltip. An
 * open one expands to show its name beside the icon and holds a visible chip,
 * so the open entry is identifiable without hovering and without reading the
 * popover. The border is present but transparent while closed, so that gaining
 * it does not shift the icon by a pixel.
 */
export function DockEntry({
  label,
  icon,
  align = 'center',
  children,
}: DockEntryProps): ReactElement {
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // useDismiss already closes on Escape. This runs first, from inside the
    // entry, and is what puts focus back on the trigger: closing the panel
    // makes it inert, and a keyboard user whose focus was inside it would
    // otherwise be dropped on the document body.
    if (event.key === 'Escape' && open) {
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    // Tabbing out of the entry closes it, so a keyboard user cannot leave a
    // trail of open popovers behind them. A null relatedTarget is left alone:
    // that is a press on a part of the panel that cannot take focus, which is
    // not the user leaving.
    const next = event.relatedTarget;
    if (next !== null && container.current?.contains(next) !== true) {
      setOpen(false);
    }
  };

  return (
    <div
      ref={container}
      className="relative inline-flex shrink-0"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <Tooltip label={label} side="top">
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen((was) => !was);
          }}
          className={cn(CHIP, open ? cn(CHIP_EXPANDED, CHIP_OPEN) : cn(CHIP_COLLAPSED, CHIP_QUIET))}
        >
          <ChipContent label={label} icon={icon} expanded={open} magnify={!open} />
        </button>
      </Tooltip>

      <DockPanel id={panelId} label={label} open={open} align={align}>
        {children(close)}
      </DockPanel>
    </div>
  );
}

/** Whether a popover trigger's face is an icon or words. */
export type DockPopoverVariant = 'chip' | 'pill';

export interface DockPopoverProps {
  /** Accessible name for the panel. Always a translated string. */
  label: string;
  /**
   * Accessible name for the trigger, and the tooltip that carries it.
   *
   * For a face that is an icon. Left off for a face that is already words,
   * where an `aria-label` would replace the value on show with a name for it
   * and a tooltip would repeat what is already legible.
   */
  triggerLabel?: string;
  /** Whether the face is an icon or words. */
  variant?: DockPopoverVariant;
  /** The trigger's face. */
  children: ReactNode;
  /** The panel's contents, given the means to close it. */
  panel: (close: () => void) => ReactNode;
  /** Which edge of the trigger the panel lines up with. */
  align?: DockPanelAlign;
  /** The panel's width, as a class. See {@link DockPanelProps}. */
  width?: string;
  /** The panel's padding, as a class. See {@link DockPanelProps}. */
  padding?: string;
  /**
   * Receives the trigger element, for a caller that has to measure it.
   *
   * The notification bell uses this: a new toast grows out of the bell, and
   * the toast layer needs to know where the bell is to do it.
   */
  triggerRef?: (node: HTMLElement | null) => void;
  /** Called when the panel opens. Never on render. */
  onOpen?: () => void;
}

/**
 * A control that states something and opens a panel about it.
 *
 * The rails are built from this: a bell whose face is an icon and a badge, and
 * a pill whose face is the figure it is reporting. Both obey the dock rule -
 * pressing one opens a panel and does nothing else - and both are read without
 * being opened, which is the point of putting them in a bar that is always
 * there.
 *
 * It is `DockEntry` without the expanding label. An entry is a shortcut whose
 * name only matters while it is open; these two are readouts whose face is the
 * information, so there is nothing to expand into.
 */
export function DockPopover({
  label,
  triggerLabel,
  variant = 'chip',
  children,
  panel,
  align = 'center',
  width,
  padding,
  triggerRef,
  onOpen,
}: DockPopoverProps): ReactElement {
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, container, close);

  // One element, two things that want to hold it: this component, for putting
  // focus back after Escape, and the caller, for measuring it.
  const setTrigger = useCallback(
    (node: HTMLButtonElement | null) => {
      trigger.current = node;
      triggerRef?.(node);
    },
    [triggerRef],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next !== null && container.current?.contains(next) !== true) {
      setOpen(false);
    }
  };

  const button = (
    <button
      ref={setTrigger}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={panelId}
      {...(triggerLabel === undefined ? {} : { 'aria-label': triggerLabel })}
      onClick={() => {
        setOpen((was) => {
          // Opening is what marks notifications read, so it is reported here
          // and not from a render, where re-rendering an open panel would
          // report it again.
          if (!was) {
            onOpen?.();
          }
          return !was;
        });
      }}
      className={cn(
        CHIP,
        'relative',
        variant === 'pill' ? CHIP_TEXT : CHIP_COLLAPSED,
        open ? CHIP_OPEN : CHIP_QUIET,
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      ref={container}
      className="relative inline-flex shrink-0"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {triggerLabel === undefined ? (
        button
      ) : (
        <Tooltip label={triggerLabel} side="top">
          {button}
        </Tooltip>
      )}

      <DockPanel
        id={panelId}
        label={label}
        open={open}
        align={align}
        {...(width === undefined ? {} : { width })}
        {...(padding === undefined ? {} : { padding })}
      >
        {panel(close)}
      </DockPanel>
    </div>
  );
}

export interface DockActionProps {
  /** Label. Always a translated string. */
  children: ReactNode;
  /** Whether the action can be used. */
  disabled?: boolean;
  /** Called on press. This one really does act. */
  onClick: () => void;
}

/**
 * The dock's single acting control, as a pill.
 *
 * A pill rather than another icon, because it is the one thing here that is
 * not a choice, and the accent marks it as the only saturated thing on screen.
 * Disabled it takes the disabled surface and the muted label rather than a
 * faded accent: fading a container lets the layer beneath bleed through, and
 * --fg-muted exists for exactly this, the label of a control that cannot be
 * used.
 */
export function DockAction({ children, disabled = false, onClick }: DockActionProps): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center rounded-pill px-4',
        'text-sm font-semibold transition-colors',
        disabled
          ? 'cursor-not-allowed bg-surface-disabled text-fg-muted'
          : 'bg-accent text-accent-fg hover:bg-accent-hover',
      )}
    >
      {children}
    </button>
  );
}
