# Design system

The rules the interface's colour and elevation follow, the full token table, and
the mistakes these rules exist to prevent.

All colour is defined once, in `apps/desktop/src/styles/tokens.css`, and
verified by `scripts/check-contrast.ts`.

## Principles

### 1. Surfaces are named by role, not by height

There is no `surface-1` or `surface-2`. A number says how high a surface sits,
which is only useful if height is what separates surfaces, and in light mode it
is not.

| Token                   | Role                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `--surface-canvas`      | The application background. Headings only, never body text         |
| `--surface-content`     | The default surface for anything with text: cards, panels, dialogs |
| `--surface-content-alt` | A content surface nested inside another one                        |
| `--surface-input`       | Text fields, text areas, selects                                   |
| `--surface-well`        | Decorative, and never carries text: the checkerboard, tracks       |
| `--surface-float`       | Dropdowns, tooltips, menus                                         |
| `--surface-disabled`    | A control that cannot be used                                      |
| `--surface-anchor`      | The status bar                                                     |

`--surface-content` carries a second guarantee: it is always fully opaque, in
every mode and whether or not a window background effect is active. A surface
that holds text has to be opaque anyway, so the two meanings agree.

### 2. The two modes separate surfaces by different means

This is the core rule. It is not an inconsistency, and it is what GitHub Primer,
Atlassian, and Material 3 all do.

**Light mode.** The canvas is grey and every content surface is white or nearly
white. Content surfaces do **not** separate from each other by lightness; they
separate by **border and shadow**. Only the canvas-to-content boundary uses
lightness. In effect there are two lightness values: grey behind, white in
front.

**Dark mode.** Content surfaces separate by **lightness**, in real steps of
0.050 L or more, with a hairline border as support. **Shadow is not a
separation mechanism here at all.**

The reason is physical rather than stylistic. A shadow is a dark shape: it reads
against a light ground and disappears against a dark one. And light mode is
capped at white, so there is no room above the canvas for a five step ladder,
while dark mode has the whole range below its chrome.

### 3. Pure white is allowed, for content

`--surface-content`, `--surface-input`, and `--surface-float` are all pure white
in light mode. They are content surfaces, and content surfaces are where text
goes.

The canvas is still never white, and never black. That is what the older rule
was really protecting: a white canvas leaves nowhere for content to sit.

### 4. Inputs move away from the text colour

In both modes. Light mode goes up to white, dark mode goes down toward black. An
input is where the user types, so it gets the most headroom for its text.

In light mode this means the field is the same white as the card it sits on, so
its border is the whole of the separation. That is why `--input-border` is
stronger than `--border-default`.

### 5. Grey means disabled

Because content surfaces are white, grey is free to carry one meaning, and it is
the meaning a reader already expects. A disabled control uses
`--surface-disabled` and `--fg-muted`, with `--border-subtle`.

`--fg-muted` is used **only** for the label of a disabled control. It does not
clear 4.5:1 on the disabled surface, and the WCAG 1.4.3 exemption that permits
that covers disabled controls and nothing else. The reason a control is
disabled, such as "Not supported by the selected engine", is information the
user has to act on, so it uses `--fg-secondary` and is held to 4.5:1.

### 6. Opacity is never used to de-emphasise a container

A faded container lets whatever is beneath it bleed through, which produces a
colour that exists in no token and destroys the separation everything else
depends on. Use `--surface-disabled` and `--fg-muted`.

Opacity is for motion, and for a full-screen overlay.

### 7. Adjacency is declared, not inferred

`tokens.css` states which surfaces touch and what separates them in light mode:

```
@separation surface-canvas > surface-content: lightness
@separation surface-content > surface-content-alt: border(--border-default)
@separation surface-content > surface-input: border(--input-border)
@separation surface-content-alt > surface-float: shadow(--shadow-md)
```

`scripts/check-contrast.ts` parses these and verifies the declared mechanism
actually holds, rather than guessing which one applies. Dark mode ignores the
mechanism and requires the lightness step on the same pairs.

## Tokens

### Light mode

| Token                   | Value                    | Notes                          |
| ----------------------- | ------------------------ | ------------------------------ |
| `--surface-canvas`      | `oklch(0.930 0.005 85)`  | The only large grey            |
| `--surface-content`     | `oklch(1.000 0 0)`       | White                          |
| `--surface-content-alt` | `oklch(0.975 0.003 85)`  | Nested card                    |
| `--surface-input`       | `oklch(1.000 0 0)`       | White, separated by its border |
| `--surface-well`        | `oklch(0.890 0.006 85)`  | Decorative only                |
| `--surface-float`       | `oklch(1.000 0 0)`       | White, separated by shadow     |
| `--surface-disabled`    | `oklch(0.930 0.005 85)`  | Grey means disabled            |
| `--surface-anchor`      | `oklch(0.220 0.008 85)`  | Status bar                     |
| `--border-subtle`       | `oklch(0 0 0 / 0.08)`    |                                |
| `--border-default`      | `oklch(0 0 0 / 0.14)`    | Carries content to content-alt |
| `--border-strong`       | `oklch(0 0 0 / 0.24)`    |                                |
| `--input-border`        | `oklch(0 0 0 / 0.18)`    | Carries content to input       |
| `--input-border-focus`  | `oklch(0.700 0.150 105)` |                                |
| `--fg-primary`          | `oklch(0.230 0.010 85)`  | Body text                      |
| `--fg-secondary`        | `oklch(0.440 0.008 85)`  | Anything that carries meaning  |
| `--fg-muted`            | `oklch(0.560 0.008 85)`  | Disabled labels only           |
| `--fg-placeholder`      | `oklch(0.545 0.008 85)`  | Inputs only, at a full 4.5:1   |
| `--fg-on-anchor`        | `oklch(0.960 0.004 85)`  | Status bar only                |
| `--accent`              | `oklch(0.880 0.190 105)` |                                |
| `--accent-hover`        | `oklch(0.845 0.190 105)` | Darker, away from the surface  |
| `--accent-fg`           | `oklch(0.220 0.030 105)` | Dark in both modes             |

### Dark mode

| Token                   | Value                    | Step                           |
| ----------------------- | ------------------------ | ------------------------------ |
| `--surface-canvas`      | `oklch(0.175 0.008 85)`  | base                           |
| `--surface-content`     | `oklch(0.235 0.009 85)`  | +0.060                         |
| `--surface-content-alt` | `oklch(0.290 0.010 85)`  | +0.055                         |
| `--surface-input`       | `oklch(0.145 0.008 85)`  | -0.090 from content            |
| `--surface-well`        | `oklch(0.130 0.008 85)`  | -0.105 from content            |
| `--surface-float`       | `oklch(0.340 0.011 85)`  | +0.050 from content-alt        |
| `--surface-disabled`    | `oklch(0.205 0.008 85)`  | +0.060 from input              |
| `--surface-anchor`      | `oklch(0.095 0.005 85)`  | -0.080 from canvas             |
| `--border-subtle`       | `oklch(1 0 0 / 0.08)`    |                                |
| `--border-default`      | `oklch(1 0 0 / 0.14)`    |                                |
| `--border-strong`       | `oklch(1 0 0 / 0.24)`    |                                |
| `--input-border`        | `oklch(1 0 0 / 0.20)`    |                                |
| `--input-border-focus`  | `oklch(0.850 0.170 105)` |                                |
| `--fg-primary`          | `oklch(0.960 0.004 85)`  |                                |
| `--fg-secondary`        | `oklch(0.760 0.006 85)`  |                                |
| `--fg-muted`            | `oklch(0.620 0.008 85)`  |                                |
| `--fg-placeholder`      | `oklch(0.640 0.008 85)`  |                                |
| `--fg-on-anchor`        | `oklch(0.940 0.004 85)`  |                                |
| `--accent`              | `oklch(0.850 0.170 105)` | L and chroma both down         |
| `--accent-hover`        | `oklch(0.885 0.180 105)` | Lighter, away from the surface |
| `--accent-fg`           | `oklch(0.180 0.030 105)` |                                |

### About the accent

One saturated colour, used sparingly: the selected tab in the title bar, the
primary button, and the single most important value on a screen. Used for
decoration it stops reading as a state.

The sliding indicator behind the selected tab is the accent. A secondary row of
pills, the gallery filters and the engine buttons in Settings, takes
`--surface-anchor` instead, so that only one thing on screen is yellow.

Two details are easy to get wrong:

- **Dark mode lowers both L and chroma.** Yellow at full chroma on a dark ground
  reads as neon.
- **Hover moves away from the surface.** Darker in light mode, lighter in dark.

`--accent-fg` is dark in **both** modes. Body text on the accent measures 1.38:1
in dark mode, which is why the accent has a foreground token of its own.

### Shadows

Light mode: alpha 0.06 to 0.16, wide, small vertical offset. This is a real
separation mechanism, and the only thing holding `--surface-float` apart from
the white beneath it.

Dark mode: alpha 0.40 to 0.60, and permitted only on `--surface-float`, which
also clears its lightness step. Everywhere else a shadow is decoration. The
check will not accept a dark pair that relies on one.

### Which text goes on which surface

Enforced exhaustively by `scripts/check-contrast.ts`. The script measures every
foreground against every text-bearing surface, so this table is the contract
rather than the list of what happens to be checked.

| Foreground         | Used on                                                     | Held to               |
| ------------------ | ----------------------------------------------------------- | --------------------- |
| `--fg-primary`     | Every text-bearing surface except the anchor and the accent | 4.5:1                 |
| `--fg-secondary`   | Every text-bearing surface except the anchor and the accent | 4.5:1                 |
| `--fg-muted`       | `--surface-disabled` only                                   | Exempt, WCAG 1.4.3    |
| `--fg-placeholder` | `--surface-input` only                                      | 4.5:1, never waivable |
| `--fg-on-anchor`   | `--surface-anchor` only                                     | 4.5:1                 |
| `--accent-fg`      | `--accent` and `--accent-hover` only                        | 4.5:1                 |

`--surface-well` carries no text at all.

## Using the tokens

### Through Tailwind

Tailwind's own palette is **removed**, not extended. `bg-gray-800` is not a
class that exists, because a stock palette colour would sit outside the
elevation system and outside the contrast checks.

```tsx
<div className="bg-surface-content text-fg-primary border border-line-subtle shadow-sm">
```

| Class                                                                                                                                                                      | Token                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `bg-surface-canvas`, `bg-surface-content`, `bg-surface-content-alt`, `bg-surface-input`, `bg-surface-well`, `bg-surface-float`, `bg-surface-disabled`, `bg-surface-anchor` | the surfaces                                       |
| `text-fg-primary`, `text-fg-secondary`, `text-fg-muted`, `text-fg-placeholder`, `text-fg-on-anchor`                                                                        | the text tokens                                    |
| `bg-accent`, `bg-accent-hover`, `text-accent-fg`                                                                                                                           | the accent                                         |
| `border-line-subtle`, `border-line`, `border-line-strong`, `border-line-input`, `border-line-focus`                                                                        | the borders                                        |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill`                                                                                                                   | the radii                                          |
| `rounded-window`, `rounded-window-inner`                                                                                                                                   | the window corner, and the corner inside the bezel |
| `shadow-sm`, `shadow-md`, `shadow-lg`                                                                                                                                      | the shadows                                        |
| `bg-danger`, `text-danger-fg`                                                                                                                                              | the only two literal colours in the theme          |
| `h-titlebar`                                                                                                                                                               | the title bar height                               |

`danger` is a pair of hex values rather than tokens, and the only such pair. The
Windows close button has to turn the system red on hover, which is a platform
colour and not part of the palette.

### Nesting

**A card inside a card uses `--surface-content-alt` and a full-strength
border.** Two `--surface-content` elements inside each other have no boundary at
all in light mode, where both are white.

**Two levels of nesting is the limit.** Past that, separate with whitespace or a
rule rather than another surface. Light mode has `content` and `content-alt` and
nothing further; there is no third near-white value that is still distinguishable
from the second.

```
canvas -> content (card) -> content-alt (nested card) -> whitespace
```

Inputs and wells are not nesting levels. An input goes on any content surface
and is separated by its own border; a well goes inside a content surface and
carries no text.

## The window chrome

The chrome is the part of the window that is not a screen: the bezel around the
interface, the title bar, and the floating dock of tools. It uses the same
tokens as everything else, with two radii of its own, and it is where the
platform background effect is shown.

### The bezel

`.app-bezel`, in `global.css`, is the ring of window around the interface. It is
4px of padding, and it carries no text of any kind.

That is what makes it the right place for the background effect. Under
`[data-vibrancy="on"]` the bezel is transparent and the platform draws Mica or
vibrancy there. With no effect it falls back to `--surface-anchor`, which is a
deliberate dark frame rather than a hole. Everything inside the bezel is opaque:
`--surface-canvas` immediately within it, and the usual content surfaces above
that.

**Every surface token is fully opaque, in every mode, whether or not an effect
is active.** There is no second, translucent token set any more. Text is never
composited against the user's wallpaper, and the declared lightness steps are
never at the wallpaper's mercy.

Because the one translucent thing holds no text, translucency is now safe in
**both** modes, which the earlier arrangement could not manage.
[ADR 0006](../architecture/decisions/0006-custom-window-decorations.md)
introduced a translucent token set for the chrome and concluded, from running
the application rather than from reading the tokens, that it had to be dark mode
only: a light mode chrome at L 0.95 composites toward the wallpaper and drops
below the content surface, measured at sRGB 209 against 225, which inverts the
elevation order.
[ADR 0009](../architecture/decisions/0009-asymmetric-surface-model.md) reached
the same conclusion from the surface side, and more sharply, because light
mode's content surfaces are pure white and have no headroom above them at all.
Neither conclusion was wrong. The bezel changes the premise: nothing that
carries text, or that has to hold a place in the elevation order, is translucent
any more, so neither failure can occur in either mode.

The frontend still never guesses whether an effect applied. Rust reports it and
the shell store sets `data-vibrancy`. Opaque is the default and the safe one.

### Window radius

Two radii belong to the window rather than to a component.

| Token                   | Value | What it is                  |
| ----------------------- | ----- | --------------------------- |
| `--radius-window`       | `8px` | The window's own corner     |
| `--radius-window-inner` | `4px` | The corner inside the bezel |

`--radius-window` has to match what the compositor draws, rather than being
chosen for looks. Windows 11 rounds a window at 8px. A bezel rounded more than
that leaves a wedge of bezel outside the system's rounded edge at each corner,
which reads as a rendering fault rather than as a design.

`--radius-window-inner` is derived, not chosen: the outer radius minus the gap
between the two corners, so 8 minus the 4px of bezel padding leaves 4. A corner
nested inside another and rounded more than its parent produces the same visible
wedge, one level in.

### The title bar

The title bar is `--titlebar-height` tall and paints no surface of its own, so
the canvas shows through it. The controls on it are content surfaces with a
shadow, which is how they separate from the canvas: by shadow in light mode and
by a lightness step in dark, exactly like a card.

It carries the application menu, back and forward, the name and tagline, the
navigation, the engine control, the theme switch, and the window buttons on the
platforms where the system draws none. `--titlebar-inset-start` reserves room
for the macOS traffic lights.

The whole header is a drag region and only the controls opt out of it, with
`.no-drag`, so the gaps between the clusters still drag the window.

### The segmented tabs

Navigation is a segmented control in the title bar rather than a rail down the
side of the window. One track holds the three screens, and a single indicator on
the accent slides between them instead of a highlight blinking from one to the
next.

The indicator's offset and width are measured from the buttons with a
`ResizeObserver`, because a translated label is a different width from the
English one and the geometry is therefore not knowable before layout. See
[ADR 0010](../architecture/decisions/0010-custom-overlay-controls.md).

### The dock

Per-screen tools live in a floating pill along the bottom of the content area,
on `--surface-anchor` with `--fg-on-anchor`. A screen with no tools renders no
dock, so only Generate has one.

The dock is not a status bar, and there is no status bar. Engine name and
readiness are a control in the title bar instead, which reports the state and
changes it in the same place, rather than a permanent band of text that is read
once and acted on somewhere else. The role table above still names
`--surface-anchor` after the status bar; the dock carries that role now, along
with the bezel whenever no background effect is active.

### Dropdowns and menus

Everything that floats above the interface, the select, the application menu,
and the engine control, is built on one `Overlay` component painted with
`--surface-float`. That is the only surface above a card, and it is held apart
from `--surface-content-alt` by shadow in light mode and by a lightness step in
dark, which is the pair `tokens.css` declares. Why those controls are written
rather than native is
[ADR 0010](../architecture/decisions/0010-custom-overlay-controls.md).

## Common mistakes

**Using a symmetric lightness ladder in both modes.** This is the mistake this
model exists to correct. Stepping up in lightness from a grey canvas gives you
more grey, so every card and every input ends up grey, and every piece of text
in the application sits on grey. Light mode separates content surfaces by border
and shadow; only dark mode uses a lightness ladder. See
[ADR 0009](../architecture/decisions/0009-asymmetric-surface-model.md).

**Checking contrast only against the foregrounds a surface is expected to
carry.** The previous check did this and passed while placeholders were
unreadable in both modes, because `--fg-placeholder` was not in its list at all.
A check built from expectations can only confirm what someone already thought
of. The current script discovers the tokens from the file and measures the
whole matrix; a pair that fails must be declared unused or exempt.

**Assuming Tailwind picks up a new token while the dev server is running.** It
does not. After adding a colour to `tailwind.config.ts`, restart the dev server.
Until then the class simply does not exist, the element has no background at
all, and it looks exactly like a broken token rather than a missing class. This
cost a debugging session already.

**Carrying the light mode shadow system into dark mode.** Shadows are close to
invisible against a dark ground. Dark mode needs a lightness step and a border;
the check refuses a dark pair that leans on a shadow.

**Making a surface translucent so that the background effect shows through it.**
A translucent surface ends up somewhere between its own value and the user's
wallpaper, and no check can predict where. Every surface token is opaque in
every mode, and the effect is shown by the bezel, which carries no text and
holds no place in the elevation order.

**Rounding a nested corner more than the corner outside it.** The inner radius
has to be the outer radius minus the gap between them. Rounded further, the
outer element shows as a wedge outside the inner curve at each corner, and it
reads as a rendering fault. This is why `--radius-window-inner` is derived from
`--radius-window` and the bezel padding rather than picked.

**Using `--fg-muted` for anything but a disabled control.** It does not clear
4.5:1, and the WCAG exemption that allows it covers disabled controls only. A
hint, a status line, or the reason an engine cannot be selected is information
the user has to act on: that is `--fg-secondary`.

**Using opacity for a disabled state.** The layer beneath bleeds through and the
result is a colour that exists in no token. Use `--surface-disabled`.

**Writing a hex colour in a component.** It will not follow the theme, and no
check will ever look at it. ESLint rejects it, and a test scans for it.

**Nesting two surfaces of the same role.** A card inside a card uses
`--surface-content-alt` and a full-strength border. Two `--surface-content`
elements inside each other have no boundary at all in light mode, where they are
both white.

**Putting text on `--surface-well`.** It is decorative. The script will fail if
the well is ever listed as text-bearing.

## Verifying

```bash
npm run check:contrast
```

Reading the output is covered in [Theming](theming.md).
