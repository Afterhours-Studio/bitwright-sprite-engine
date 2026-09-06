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

| Token | Role |
| --- | --- |
| `--surface-canvas` | The application background. Headings only, never body text |
| `--surface-content` | The default surface for anything with text: cards, panels, dialogs |
| `--surface-content-alt` | A content surface nested inside another one |
| `--surface-input` | Text fields, text areas, selects |
| `--surface-well` | Decorative, and never carries text: the checkerboard, tracks |
| `--surface-float` | Dropdowns, tooltips, menus |
| `--surface-disabled` | A control that cannot be used |
| `--surface-anchor` | The status bar |

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

| Token | Value | Notes |
| --- | --- | --- |
| `--surface-canvas` | `oklch(0.930 0.005 85)` | The only large grey |
| `--surface-content` | `oklch(1.000 0 0)` | White |
| `--surface-content-alt` | `oklch(0.975 0.003 85)` | Nested card |
| `--surface-input` | `oklch(1.000 0 0)` | White, separated by its border |
| `--surface-well` | `oklch(0.890 0.006 85)` | Decorative only |
| `--surface-float` | `oklch(1.000 0 0)` | White, separated by shadow |
| `--surface-disabled` | `oklch(0.930 0.005 85)` | Grey means disabled |
| `--surface-anchor` | `oklch(0.220 0.008 85)` | Status bar |
| `--border-subtle` | `oklch(0 0 0 / 0.08)` | |
| `--border-default` | `oklch(0 0 0 / 0.14)` | Carries content to content-alt |
| `--border-strong` | `oklch(0 0 0 / 0.24)` | |
| `--input-border` | `oklch(0 0 0 / 0.18)` | Carries content to input |
| `--input-border-focus` | `oklch(0.700 0.150 105)` | |
| `--fg-primary` | `oklch(0.230 0.010 85)` | Body text |
| `--fg-secondary` | `oklch(0.440 0.008 85)` | Anything that carries meaning |
| `--fg-muted` | `oklch(0.560 0.008 85)` | Disabled labels only |
| `--fg-placeholder` | `oklch(0.545 0.008 85)` | Inputs only, at a full 4.5:1 |
| `--fg-on-anchor` | `oklch(0.960 0.004 85)` | Status bar only |
| `--accent` | `oklch(0.880 0.190 105)` | |
| `--accent-hover` | `oklch(0.845 0.190 105)` | Darker, away from the surface |
| `--accent-fg` | `oklch(0.220 0.030 105)` | Dark in both modes |

### Dark mode

| Token | Value | Step |
| --- | --- | --- |
| `--surface-canvas` | `oklch(0.175 0.008 85)` | base |
| `--surface-content` | `oklch(0.235 0.009 85)` | +0.060 |
| `--surface-content-alt` | `oklch(0.290 0.010 85)` | +0.055 |
| `--surface-input` | `oklch(0.145 0.008 85)` | -0.090 from content |
| `--surface-well` | `oklch(0.130 0.008 85)` | -0.105 from content |
| `--surface-float` | `oklch(0.340 0.011 85)` | +0.050 from content-alt |
| `--surface-disabled` | `oklch(0.205 0.008 85)` | +0.060 from input |
| `--surface-anchor` | `oklch(0.095 0.005 85)` | -0.080 from canvas |
| `--border-subtle` | `oklch(1 0 0 / 0.08)` | |
| `--border-default` | `oklch(1 0 0 / 0.14)` | |
| `--border-strong` | `oklch(1 0 0 / 0.24)` | |
| `--input-border` | `oklch(1 0 0 / 0.20)` | |
| `--input-border-focus` | `oklch(0.850 0.170 105)` | |
| `--fg-primary` | `oklch(0.960 0.004 85)` | |
| `--fg-secondary` | `oklch(0.760 0.006 85)` | |
| `--fg-muted` | `oklch(0.620 0.008 85)` | |
| `--fg-placeholder` | `oklch(0.640 0.008 85)` | |
| `--fg-on-anchor` | `oklch(0.940 0.004 85)` | |
| `--accent` | `oklch(0.850 0.170 105)` | L and chroma both down |
| `--accent-hover` | `oklch(0.885 0.180 105)` | Lighter, away from the surface |
| `--accent-fg` | `oklch(0.180 0.030 105)` | |

### About the accent

One saturated colour, used sparingly: the active navigation pill, the primary
button, and the single most important value on a screen. Used for decoration it
stops reading as a state.

Navigation pills take the accent. A secondary row of filters takes
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

| Foreground | Used on | Held to |
| --- | --- | --- |
| `--fg-primary` | Every text-bearing surface except the anchor and the accent | 4.5:1 |
| `--fg-secondary` | Every text-bearing surface except the anchor and the accent | 4.5:1 |
| `--fg-muted` | `--surface-disabled` only | Exempt, WCAG 1.4.3 |
| `--fg-placeholder` | `--surface-input` only | 4.5:1, never waivable |
| `--fg-on-anchor` | `--surface-anchor` only | 4.5:1 |
| `--accent-fg` | `--accent` and `--accent-hover` only | 4.5:1 |

`--surface-well` carries no text at all.

## Using the tokens

### Through Tailwind

Tailwind's own palette is **removed**, not extended. `bg-gray-800` is not a
class that exists, because a stock palette colour would sit outside the
elevation system and outside the contrast checks.

```tsx
<div className="bg-surface-content text-fg-primary border border-line-subtle shadow-sm">
```

| Class | Token |
| --- | --- |
| `bg-surface-canvas`, `bg-surface-content`, `bg-surface-content-alt`, `bg-surface-input`, `bg-surface-well`, `bg-surface-float`, `bg-surface-disabled`, `bg-surface-anchor` | the surfaces |
| `text-fg-primary`, `text-fg-secondary`, `text-fg-muted`, `text-fg-placeholder`, `text-fg-on-anchor` | the text tokens |
| `bg-accent`, `text-accent-fg` | the accent |
| `border-line-subtle`, `border-line`, `border-line-strong`, `border-line-input`, `border-line-focus` | the borders |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill` | the radii |
| `shadow-sm`, `shadow-md`, `shadow-lg` | the shadows |

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

### Translucency

When a platform background effect is active, a second token set takes over,
selected by `[data-vibrancy="on"]` on the root element.

**The frontend never guesses whether the effect applied.** Rust reports it, and
the frontend sets the attribute. Opaque is the default and the safe one: an
active effect behind opaque surfaces looks flat, while transparent surfaces with
no effect leave text over a wallpaper.

**The translucent set is dark mode only.** A translucent surface composites as
`alpha * surface + (1 - alpha) * wallpaper`, and the wallpaper is the user's.
In light mode the chrome sits at L 0.95, just under the ceiling, so any dark
wallpaper drags it below the content surface at L 0.905 and the elevation order
inverts: the panel reads as lower than the canvas it sits on. Measured on a real
desktop, surface-1 rendered at sRGB 209 against content at 225. No alpha fixes
it, because light mode has no headroom above the chrome. Dark mode has the whole
range below its chrome, so it blends safely.

Three rules:

1. **Text is never placed directly on a vibrancy surface.** The image behind it
   is outside our control, so no contrast guarantee can be made. Text sits on a
   surface with alpha of at least 0.85, or a fully opaque one.
2. **Only chrome is translucent.** Title bar, sidebar, outermost background. The
   content area uses `--surface-content`, which is never overridden.
3. **Light mode stays opaque.** See above.

See [decision 0006](../architecture/decisions/0006-custom-window-decorations.md).

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

**Assuming a translucent surface keeps its place in the order.** It ends up
somewhere between its own value and the user's wallpaper, and no check can
predict where. This is why the translucent variant is dark mode only, why its
alphas are all at or above 0.90, and why it never touches `--surface-content`.

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
