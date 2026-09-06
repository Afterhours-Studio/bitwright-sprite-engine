# 10. Draw our own dropdowns, and keep the native keyboard model

Date: 2026-02-12

## Status

Accepted

## Context

The window is drawn by the application. ADR 0006 turned the system decorations
off and took on the title bar. ADR 0009 defined the surfaces everything inside
it is painted with, and `scripts/check-contrast.ts` measures every one of them.
In the middle of that sat a native `<select>`.

A native select's popup is not part of the page. The platform draws it, in the
platform's own colours, with the platform's own corner radius, and no CSS
reaches it. On Windows it is a grey slab with square edges opening inside a
rounded, themed window. Nothing in `tokens.css` applies to it and the contrast
check cannot see it, so the one control a user is looking at while they read a
value was the one control outside the design system.

What the native control gets right is the keyboard, and it is worth naming
exactly, because it is the part worth keeping. Enter, Space, and either arrow
key open the list. The arrows move the highlight. Home and End jump to the ends.
Enter commits. Escape cancels. Every user of the application already knows that,
and none of it depends on who draws the popup.

The chrome then needed panels no native element provides at all. The title bar
carries a menu with submenus, and an engine control that reports whether the
engine is ready and switches it in the same place. Neither of those is a
`<select>`. Each is a panel floating over a trigger, and each raises the same
two questions: how it closes, and what it is while it is closed.

Both questions have an easy answer that is wrong. Unmounting a panel when it
closes is the simplest way to hide it, and it makes dismissal snap, because
there is nothing left on the page to animate. Closing on `click` is the usual
listener to reach for, and it fires when the press completes, by which point the
press has already landed on whatever was underneath the panel.

## Decision

The controls are written, and they share their parts.

| File                              | What it is                                               |
| --------------------------------- | -------------------------------------------------------- |
| `components/ui/Overlay.tsx`       | The floating panel every dropdown and menu is built from |
| `hooks/useDismiss.ts`             | Escape, and a press outside, for all of them             |
| `components/ui/Select.tsx`        | The listbox that replaces `<select>`                     |
| `components/ui/Menu.tsx`          | The title bar menu and its submenus                      |
| `components/ui/SegmentedTabs.tsx` | The navigation control in the title bar                  |

**The select is written, and the native keyboard model is reimplemented on it.**
The trigger is a button with `role="combobox"` over a `ul` with
`role="listbox"`, and it handles the keys listed above. The trigger keeps focus
while the list is open, the options are buttons at `tabIndex={-1}`, and the
highlighted option is held in state. Pointer and keyboard meet there: moving the
pointer over an option makes it the highlighted one, so Enter commits what the
pointer is resting on.

**A closed overlay stays mounted.** `Overlay` toggles opacity, scale, pointer
events, `aria-hidden`, and `inert`, and transitions the first two. Removing it
from the tree, or using `hidden`, would take it out of the layout in the same
frame and skip the transition, which is what makes a dismissal snap. It is out
of the accessibility tree and out of the tab order while closed, so staying
mounted costs nothing a user can reach.

**Dismissal listens on `pointerdown`, not `click`.** `useDismiss` registers a
capturing `pointerdown` listener on the document and closes as the press begins,
which is what a platform popup does. It also closes on Escape.

**The segmented control measures its indicator instead of computing it.** One
absolutely positioned element slides between positions, and its offset and width
are read from the selected button with a `ResizeObserver` on the track and on
every button. A computed geometry, equal shares of the track or an index times a
fixed width, is wrong as soon as a label is translated into a longer language,
and wrong again when the window is resized. Measuring is also the only reason
that component holds state: the geometry is not knowable until after layout.
The indicator is not animated until the first measurement lands, so it does not
slide in from the left edge on mount.

The engine control in the title bar is built from `Overlay` and `useDismiss`
directly rather than from `Select`, because its rows carry the reason an engine
is unavailable underneath the engine's name.

## Consequences

Positive:

- The list follows the theme. It is painted with `--surface-float` like every
  other floating panel, so it is inside the surface model and inside the
  contrast check, which a platform-drawn popup can never be.
- Every overlay in the application closes the same way, because they call the
  same hook. Escape and an outside press behave identically in the select, the
  menu, and the engine control.
- A press outside an overlay no longer reaches what was underneath it.
- The keyboard model is the platform's, so there is nothing new for a user to
  learn from a control that looks unfamiliar.
- The navigation indicator survives translation and resizing, because it is
  measured rather than assumed. The interface ships in two languages already.
- Closing animates rather than snapping, and the reduced motion rule in
  `global.css` still applies to it, because the transition is a CSS one.

Negative:

- ARIA is ours now. `role`, `aria-expanded`, `aria-controls`, `aria-haspopup`,
  `aria-selected`, `aria-hidden`, and `inert` are written by hand on each
  control, and nothing fails when one is missing or wrong. The native select
  carried all of it and could not be got wrong.
- Focus management is ours too. The trigger holds focus while the list is open
  and the options are out of the tab order, so the whole keyboard experience
  rests on one key handler being correct, with no browser behaviour underneath
  it to fall back on.
- Four components and a hook exist where there was one element, and each is
  somewhere a bug can live. Every future control of this shape has to be built
  from them rather than declared.
- What the native control does and ours does not is invisible until someone
  hits it. Typing a letter to jump to an option is not implemented.
- The list is an element inside the window, so the window clips it. A platform
  popup can extend past the window edge and ours cannot; a long list scrolls
  inside a fixed maximum height instead.
- The control now looks and behaves the same on all three platforms. That is
  what the theme wants and it is a divergence from every platform convention at
  once, so a user who expects their own system's dropdown will not get it.
- Tests query by role, which proves a role is present. It does not prove a
  screen reader announces the control usefully, and nothing in the pipeline
  checks that.

Neutral:

- The menu's accelerators are labels only. Binding them is the application's
  job, because the same command has to work while the menu is closed.
- jsdom has no `ResizeObserver`, so the tests stub it. The indicator is
  therefore never measured under test and its geometry is not covered.
- The chrome these controls sit in, the bezel, the title bar, and the per-screen
  dock, is described in [the design system](../../development/design-system.md).
  This record covers the controls, not the layout.
