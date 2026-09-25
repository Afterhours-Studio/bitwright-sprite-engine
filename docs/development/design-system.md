# Design system

The rules the interface's colour, shape, type and elevation follow, the full
token table, and the mistakes these rules exist to prevent.

All colour is defined once, in `apps/desktop/src/styles/tokens.css`, and
verified by `scripts/check-contrast.ts`.

## The studio

The interface is the studio: its **layout** follows a reference pixel-art
studio one to one, and its **look** is Bitwright's own, the system on this
page.

- [The studio layout](../architecture/studio-layout.md) is the layout's
  contract: which regions exist, where they sit, what each holds and in what
  order, their sizes and spacing. The class strings it quotes are the
  reference's, and only their structure and sizes are used.
- [The studio style](../architecture/studio-style.md) is the look's contract:
  how each of the reference's colour and shape classes maps onto a token
  here.

Everything a screen paints comes from the tokens below and the shared
components in `components/ui/`: `Button` (primary, secondary, ghost, danger),
`IconButton`, `SegmentedTabs`, `Select` and `ComboBox`, `Field`, `NumberField`,
`Dialog`, `Menu`, `Tooltip`, `Pill` and `Card`. A bespoke control is fine where
the layout needs one, such as a tool row or a frame card, but it takes its
colours and shapes from the same tokens.

### Type and icons

- **Font:** the Inter / system stack, `Inter, system-ui, -apple-system,
Segoe UI, sans-serif`, as `font-sans`. Monospace text uses the platform's
  own monospace stack, `font-mono`.
- **Sizes:** `text-sm` for body text, `text-xs` for secondary text, and
  `text-[11px]` for the smallest, such as keys and badges. Nothing is smaller
  than 11px.
- **Icons:** `lucide-react`, at stroke width 1.75, `h-4 w-4` in tool rows and
  the header and smaller in small buttons. lucide is an icon set, not a theme,
  and it replaces nothing Bitwright had drawn.

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
| `--surface-float`       | Dropdowns, tooltips, menus, floating panels                        |
| `--surface-disabled`    | A control that cannot be used                                      |
| `--surface-anchor`      | The contrast anchor: the bezel with no effect, the anchor pill     |

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
while dark mode has the whole range below it.

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

Opacity is for motion, for onion skin on the stage, and for a full-screen
overlay.

### 7. Adjacency is declared, not inferred

`tokens.css` states which surfaces touch and what separates them in light mode:

```
@separation surface-canvas > surface-content: lightness
@separation surface-canvas > surface-anchor: lightness
@separation surface-content > surface-content-alt: border(--border-default)
@separation surface-content > surface-input: border(--input-border)
@separation surface-content > surface-well: lightness
@separation surface-content-alt > surface-float: shadow(--shadow-md)
@separation surface-input > surface-disabled: lightness
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
| `--surface-anchor`      | `oklch(0.220 0.008 85)`  | Contrast anchor                |
| `--border-subtle`       | `oklch(0 0 0 / 0.08)`    |                                |
| `--border-default`      | `oklch(0 0 0 / 0.14)`    | Carries content to content-alt |
| `--border-strong`       | `oklch(0 0 0 / 0.24)`    |                                |
| `--input-border`        | `oklch(0 0 0 / 0.18)`    | Carries content to input       |
| `--input-border-focus`  | `oklch(0.700 0.150 105)` |                                |
| `--fg-primary`          | `oklch(0.230 0.010 85)`  | Body text                      |
| `--fg-secondary`        | `oklch(0.440 0.008 85)`  | Anything that carries meaning  |
| `--fg-muted`            | `oklch(0.560 0.008 85)`  | Disabled labels only           |
| `--fg-placeholder`      | `oklch(0.545 0.008 85)`  | Inputs only, at a full 4.5:1   |
| `--fg-on-anchor`        | `oklch(0.960 0.004 85)`  | Anchor only                    |
| `--accent`              | `oklch(0.880 0.190 105)` | Yellow                         |
| `--accent-hover`        | `oklch(0.845 0.190 105)` | Darker, away from the surface  |
| `--accent-fg`           | `oklch(0.220 0.030 105)` | Dark in both modes             |
| `--severity-info`       | `oklch(0.550 0.150 250)` |                                |
| `--severity-success`    | `oklch(0.520 0.140 150)` |                                |
| `--severity-warning`    | `oklch(0.545 0.135 70)`  |                                |
| `--severity-error`      | `oklch(0.550 0.200 25)`  |                                |

Neutrals keep a small non-zero chroma at hue 85, a warm grey, except where a
value is pure white.

### Dark mode

| Token                   | Value                    | Step                           |
| ----------------------- | ------------------------ | ------------------------------ |
| `--surface-canvas`      | `oklch(0.255 0.008 85)`  | base                           |
| `--surface-content`     | `oklch(0.315 0.009 85)`  | +0.060                         |
| `--surface-content-alt` | `oklch(0.370 0.010 85)`  | +0.055                         |
| `--surface-input`       | `oklch(0.225 0.008 85)`  | -0.090 from content            |
| `--surface-well`        | `oklch(0.210 0.008 85)`  | -0.105 from content            |
| `--surface-float`       | `oklch(0.420 0.011 85)`  | +0.050 from content-alt        |
| `--surface-disabled`    | `oklch(0.285 0.008 85)`  | +0.060 from input              |
| `--surface-anchor`      | `oklch(0.175 0.005 85)`  | -0.080 from canvas             |
| `--border-subtle`       | `oklch(1 0 0 / 0.08)`    |                                |
| `--border-default`      | `oklch(1 0 0 / 0.14)`    |                                |
| `--border-strong`       | `oklch(1 0 0 / 0.24)`    |                                |
| `--input-border`        | `oklch(1 0 0 / 0.20)`    |                                |
| `--input-border-focus`  | `oklch(0.850 0.170 105)` |                                |
| `--fg-primary`          | `oklch(0.960 0.004 85)`  |                                |
| `--fg-secondary`        | `oklch(0.815 0.006 85)`  | Floor set by the float surface |
| `--fg-muted`            | `oklch(0.620 0.008 85)`  |                                |
| `--fg-placeholder`      | `oklch(0.640 0.008 85)`  |                                |
| `--fg-on-anchor`        | `oklch(0.940 0.004 85)`  |                                |
| `--accent`              | `oklch(0.850 0.170 105)` | L and chroma both down         |
| `--accent-hover`        | `oklch(0.885 0.180 105)` | Lighter, away from the surface |
| `--accent-fg`           | `oklch(0.180 0.030 105)` |                                |
| `--severity-info`       | `oklch(0.800 0.110 250)` | Lighter than the float surface |
| `--severity-success`    | `oklch(0.820 0.140 150)` |                                |
| `--severity-warning`    | `oklch(0.840 0.130 80)`  |                                |
| `--severity-error`      | `oklch(0.820 0.115 25)`  |                                |

The dark ladder sits higher than the first one did. OKLCH lightness is not sRGB
lightness: low L values that read as reasonable numbers rendered as an almost
black interface. Check any new value by rendering it, never by reading it.

### About the accent

One saturated colour, yellow, used sparingly: the active tool, the primary
button, the current item or step, and the single most important value on a
screen. Used for decoration it stops reading as a state.

A secondary row of pills takes `--surface-anchor` instead (the `anchor` tone of
`Pill`), and a toggle that is on is a pressed state on the content surfaces,
not a second accent, so that only one kind of thing on screen is yellow.

Two details are easy to get wrong:

- **Dark mode lowers both L and chroma.** Yellow at full chroma on a dark ground
  reads as neon.
- **Hover moves away from the surface.** Darker in light mode, lighter in dark.

`--accent-fg` is dark in **both** modes. Body text on the accent measures 1.38:1
in dark mode, which is why the accent has a foreground token of its own.

### Severity

Four marker colours: `--severity-info`, `--severity-success`,
`--severity-warning` and `--severity-error`, used as `text-severity-*`. They
mark a notification's icon, a gate that passed or failed, and a warning. They
are not surfaces and not general foregrounds.

Their hues are the four a reader already has a meaning for, and the four
furthest from the yellow accent, so a severity mark is never mistaken for the
selected state. Every one clears 4.5:1 on `--surface-float` in both modes, not
only the 3:1 WCAG 1.4.11 asks of a graphic, so a severity colour on a short
word is legal too.

The only other literal colour is `danger`: the Windows close button turns the
system red on hover.

### Radii

| Token                   | Value   | Used for                              |
| ----------------------- | ------- | ------------------------------------- |
| `--radius-sm`           | `6px`   | Small controls and swatches           |
| `--radius-md`           | `10px`  | Rows, cards and inputs                |
| `--radius-lg`           | `14px`  | Panels, dialogs and floating toolbars |
| `--radius-pill`         | `999px` | Buttons and segmented controls        |
| `--radius-window`       | `8px`   | The window's own corner               |
| `--radius-window-inner` | `4px`   | The corner inside the bezel           |

`rounded-full` is for dots and round buttons. The scale is kept tight on
purpose: a 20px corner at this card size reads as a rounded rectangle first and
a panel second.

### Shadows

Three, `--shadow-sm`, `--shadow-md` and `--shadow-lg`, and never a coloured
one.

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

Tailwind's own palette is **removed**, not extended. `bg-gray-800`,
`bg-neutral-900` and `text-pink-400` are not classes that exist, because a
stock palette colour would sit outside the surface model and outside the
contrast checks.

```tsx
<div className="rounded-md border border-line-subtle bg-surface-content text-fg-primary shadow-sm">
```

| Class                                                                                                                                                                      | Token                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `bg-surface-canvas`, `bg-surface-content`, `bg-surface-content-alt`, `bg-surface-input`, `bg-surface-well`, `bg-surface-float`, `bg-surface-disabled`, `bg-surface-anchor` | the surfaces                                       |
| `text-fg-primary`, `text-fg-secondary`, `text-fg-muted`, `text-fg-placeholder`, `text-fg-on-anchor`                                                                        | the text tokens                                    |
| `bg-accent`, `bg-accent-hover`, `text-accent-fg`                                                                                                                           | the accent                                         |
| `border-line-subtle`, `border-line`, `border-line-strong`, `border-line-input`, `border-line-focus`                                                                        | the borders                                        |
| `text-severity-info`, `text-severity-success`, `text-severity-warning`, `text-severity-error`                                                                              | the severity marks                                 |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill`, `rounded-full`                                                                                                   | the radii                                          |
| `rounded-window`, `rounded-window-inner`                                                                                                                                   | the window corner, and the corner inside the bezel |
| `shadow-sm`, `shadow-md`, `shadow-lg`                                                                                                                                      | the shadows                                        |
| `bg-danger`, `text-danger-fg`                                                                                                                                              | the only two literal colours in the theme          |

A bare `border` with no colour takes `--border-default`.

`danger` is a pair of hex values rather than tokens, and the only such pair. The
Windows close button has to turn the system red on hover, which is a platform
colour and not part of the theme.

### Utilities

Defined in `apps/desktop/src/styles/global.css`:

| Class                   | What it is                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `.app-bezel`            | The ring of window around the interface; see [the bezel](#the-bezel)                            |
| `.sprite-checkerboard`  | The checker behind the sprite on the stage: `--surface-well` with squares in `--border-subtle`  |
| `.checkerboard-pattern` | The same checker at 8px, behind a thumbnail                                                     |
| `.palette-swatch`       | A palette slot painted from `--swatch`, which is a pixel of the sprite, not an interface colour |
| `.pixelated`            | `image-rendering: pixelated`, so a scaled sprite stays square pixels                            |
| `.no-drag`              | Opts a control out of a window drag region                                                      |

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

## The window

The window has no system decorations and no separate title bar. `AppShell` in
`components/layout/` draws the bezel and an opaque container inside it, and
the current screen fills that container.

- **Each screen's top row is the drag region.** Home's content header, the
  editor's header and the Settings header carry `data-tauri-drag-region`, and
  the window controls, `WindowControls` in `components/layout/`, sit at their
  trailing end. Controls opt out of the drag with `.no-drag`.
- **On Windows the close button turns the system red on hover**, the `danger`
  pair. On macOS the system's traffic lights draw themselves.
- **The layers every screen shares**, the new sprite dialog, the command
  palette and the toasts, are mounted once in `AppShell`, inside the container,
  so an overlay never paints over the bezel or the window's rounded corner.

Why the decorations are drawn by the application at all is
[ADR 0006](../architecture/decisions/0006-custom-window-decorations.md).

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
is active.** There is no translucent token set. Text is never composited
against the user's wallpaper, and the declared lightness steps are never at the
wallpaper's mercy.

Because the one translucent thing holds no text, translucency is safe in
**both** modes.
[ADR 0006](../architecture/decisions/0006-custom-window-decorations.md)
introduced a translucent token set for the chrome and concluded, from running
the application rather than from reading the tokens, that it had to be dark mode
only: a light mode chrome at L 0.95 composites toward the wallpaper and drops
below the content surface, measured at sRGB 209 against 225, which inverts the
elevation order.
[ADR 0009](../architecture/decisions/0009-asymmetric-surface-model.md) reached
the same conclusion from the surface side. The bezel changes the premise:
nothing that carries text, or that has to hold a place in the elevation order,
is translucent, so neither failure can occur in either mode.

The frontend never guesses whether an effect applied. Rust reports it and the
shell store sets `data-vibrancy`. Opaque is the default and the safe one.

### Window radius

`--radius-window` has to match what the compositor draws, rather than being
chosen for looks. Windows 11 rounds a window at 8px. A bezel rounded more than
that leaves a wedge of bezel outside the system's rounded edge at each corner,
which reads as a rendering fault rather than as a design.

`--radius-window-inner` is derived, not chosen: the outer radius minus the gap
between the two corners, so 8 minus the 4px of bezel padding leaves 4. A corner
nested inside another and rounded more than its parent produces the same visible
wedge, one level in.

### Dropdowns and menus

Everything that floats above the interface, the select, the combo box, the
menus, the notification list and the command palette, is built on one
`Overlay` component painted with `--surface-float`. That is the only surface
above a card, and it is held apart from `--surface-content-alt` by shadow in
light mode and by a lightness step in dark, which is the pair `tokens.css`
declares. Escape closes the top one, and a press outside it does not reach
what was underneath. Why those controls are written rather than native is
[ADR 0010](../architecture/decisions/0010-custom-overlay-controls.md).

## Common mistakes

**Using a Tailwind palette class.** `bg-neutral-900`, `text-pink-400`,
`border-sky-500`, `bg-white` and the rest are not in the theme, so the class
compiles to nothing and the element silently loses its colour. It is also how
the studio's look once drifted away from the tokens. `src/test/tokens.test.ts`
fails on any such class, and on `bg-gradient-to-*`, anywhere in `src`. Use the
mapping in [the studio style](../architecture/studio-style.md).

**Copying a class string from the studio layout as it is.** The layout quotes
the reference's classes for their structure and sizes. Its colours, corners and
shadows are replaced by the tokens, as the studio style maps them.

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

**Colouring a shadow.** Elevation is `shadow-sm`, `shadow-md` or `shadow-lg`,
and nothing else.

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
check will ever look at it. A test scans every source file and allows literal
colours only in `tokens.css`.

**Setting text under 11px.** `text-[11px]` is the floor, for keys and badges.

**Nesting two surfaces of the same role.** A card inside a card uses
`--surface-content-alt` and a full-strength border. Two `--surface-content`
elements inside each other have no boundary at all in light mode, where they are
both white.

**Putting text on `--surface-well`.** It is decorative. The script will fail if
the well is ever listed as text-bearing.

## Verifying

```bash
npm run check:contrast
npm run test
```

Reading the contrast output is covered in [Theming](theming.md).
