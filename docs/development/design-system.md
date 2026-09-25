# Design system

The rules the interface's colour, type and elevation follow, the full token
table, and the mistakes these rules exist to prevent.

The interface is the 1.1 studio layout: a reference pixel-art studio
reproduced one to one in structure, spacing, type and colour, with Bitwright's
own features in it. The region-by-region contract, with the class strings each
screen uses, is [the studio layout](../architecture/studio-layout.md). This
page is the system underneath it.

All colour is defined once, in `apps/desktop/src/styles/tokens.css`, and the
role tokens are verified by `scripts/check-contrast.ts`.

## The studio look

### Type and icons

- **Font:** Manrope Variable, from `@fontsource-variable/manrope`, as
  `font-sans`. Monospace text uses the platform's own monospace stack.
- **Icons:** `lucide-react`, at `w-4 h-4` in tool rows and the header,
  `w-3.5 h-3.5` in small buttons and `w-3 h-3` in the smallest.

### Two layers of colour

The theme has two layers of colour, and both are deliberate.

**Tailwind's palette, which the layout paints with.** The reference is written
in Tailwind's own classes, so copying it one to one means those classes have to
exist exactly as Tailwind 3 defines them:

| Scale                                              | Source                                     |
| -------------------------------------------------- | ------------------------------------------ |
| `neutral` 50 to 950                                | CSS variables, inverted for light mode     |
| `pink`, `sky`, `purple`, `red`, `amber`, `emerald` | Tailwind's fixed values                    |
| `white`, `black`                                   | Tailwind's fixed values                    |
| `studio-home`, `studio-home-side`, `studio-card`   | CSS variables, the three home-screen greys |

No other scale exists. `colors` replaces Tailwind's default palette rather
than extending it, so `bg-gray-800` is still not a class.

**The role tokens, which the contrast check measures.** `surface-*`, `fg-*`,
`line-*` and `accent` stay beside the scales and are re-pointed at the studio
look, so a component still written against them paints the same greys as one
written in the neutral scale, and the check keeps measuring the pairs text
actually sits on. Why the palette came back is recorded in
[DECISIONS.md](../DECISIONS.md), "Tailwind's palette comes back, through
variables".

### The neutral scale, through variables

`neutral` is the scale the light theme has to invert, so each step reads a
variable holding bare sRGB channels:

```ts
// tailwind.config.ts
neutral: { 900: 'rgb(var(--neutral-900) / <alpha-value>)', ... }
```

Bare channels rather than a colour are what let the opacity modifier work:
`bg-neutral-900/40` compiles to `rgb(var(--neutral-900) / 0.4)`.

In dark mode the variables hold Tailwind's own neutral values, 50 `#fafafa`
through 950 `#0a0a0a`. In light mode they hold the same scale inverted, 50
swapped with 950, 100 with 900 and so on, so `bg-neutral-950` is near black in
dark mode and near white in light mode. A component written for the dark
reference reads the right way round in light mode without a single `dark:`
variant.

### How the accents are used

Each accent scale carries one meaning, and only that one:

| Accent                    | Means                                                         |
| ------------------------- | ------------------------------------------------------------- |
| `pink`                    | The active tool, the primary action, the current item or step |
| `sky`                     | A toggle that is on, export, the zoom readout                 |
| `purple`                  | Layers                                                        |
| `red`, `amber`, `emerald` | Destructive hover, warnings, a passing gate                   |

A pink that means "selected" in one place and "decoration" in another stops
reading as a state in either.

### Radii and shadows

Tailwind's default scales, for the same reason as the palette: `rounded`,
`rounded-xl` and `shadow-md shadow-pink-600/20` are written into the reference
and have to mean what they mean there. `rounded` (4px) is the default corner,
`rounded-xl` is for dialogs, and `rounded-full` for round buttons. Tailwind 3
has no `shadow-xs`; the theme adds it with the value later versions give it.

### Utilities

Defined in `apps/desktop/src/styles/global.css`:

| Class                   | What it is                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `.canvas-workspace-bg`  | The editor's workspace: a faint 20px diagonal checker over `--workspace`                        |
| `.checkerboard-pattern` | The small checker behind a thumbnail, so a transparent pixel reads as transparent               |
| `.sprite-checkerboard`  | The checker behind the sprite on the stage, sized to two sprite pixels                          |
| `.palette-swatch`       | A palette slot painted from `--swatch`, which is a pixel of the sprite, not an interface colour |
| `.pixelated`            | `image-rendering: pixelated`, so a scaled sprite stays square pixels                            |
| `.no-drag`              | Opts a control out of a window drag region                                                      |

## The window

The window has no system decorations, no bezel and no separate title bar.

- **Each screen's top row is the drag region.** Home's content header, the
  editor's `h-14` header and the Settings header carry
  `data-tauri-drag-region`, and the window controls sit at their trailing end.
  The controls themselves are `WindowControls` in `components/layout/`.
- **The frame is opaque.** `AppShell` paints `bg-neutral-950` over the whole
  window, whether or not the platform applied Mica or vibrancy. The studio look
  has no translucent surface to show the effect through, so text never sits on
  the user's wallpaper. Settings still reports whether the effect applied.
- **The frame is rounded to `--radius-window`**, 8px, which is what Windows 11
  and macOS clip an undecorated window to, so the corner outside it is one the
  platform would have cut away anyway.
- **On Windows the close button turns the system red on hover**, the `danger`
  pair in `tailwind.config.ts`, which is a platform colour rather than part of
  either palette. On macOS the system's traffic lights are left to draw
  themselves.

The layers every screen shares, the new sprite dialog, the command palette and
the toasts, are mounted once in `AppShell` rather than in whichever screen is
in front.

Why the decorations are drawn by the application at all is
[ADR 0006](../architecture/decisions/0006-custom-window-decorations.md); its
title bar and bezel are what the studio layout replaced.

## The role tokens

The rest of this page is the role-token system. It is what the contrast check
measures, and it still paints the base styles (body text, focus rings, text
selection) and any component not written in the neutral scale.

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
| `--surface-anchor`      | The contrast anchor                                                |

The anchor was the status bar, and later the dock. The studio layout has
neither, so nothing paints it today; it is kept, and measured, so that a band
of strong contrast has a checked pair the day one is needed.

`--surface-content` carries a second guarantee: it is always fully opaque, in
every mode. A surface that holds text has to be opaque anyway, so the two
meanings agree.

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
separation mechanism here at all.** Every dark surface but the float is a
Tailwind neutral step, so the role tokens and the neutral scale agree.

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
disabled is information the user has to act on, so it uses `--fg-secondary`
and is held to 4.5:1.

### 6. Opacity is never used to de-emphasise a role-token container

A faded role-token container lets whatever is beneath it bleed through, which
produces a colour that exists in no token and destroys the separation
everything else depends on. Use `--surface-disabled` and `--fg-muted`.

The studio layout does use the neutral scale's opacity modifier, as in
`bg-neutral-900/40` for a panel head, because the reference does. Those are
tints of the scale over a known neutral ground, not role surfaces.

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

| Token                   | Value                      | Notes                          |
| ----------------------- | -------------------------- | ------------------------------ |
| `--surface-canvas`      | `oklch(0.930 0.005 85)`    | The only large grey            |
| `--surface-content`     | `oklch(1.000 0 0)`         | White                          |
| `--surface-content-alt` | `oklch(0.975 0.003 85)`    | Nested card                    |
| `--surface-input`       | `oklch(1.000 0 0)`         | White, separated by its border |
| `--surface-well`        | `oklch(0.890 0.006 85)`    | Decorative only                |
| `--surface-float`       | `oklch(1.000 0 0)`         | White, separated by shadow     |
| `--surface-disabled`    | `oklch(0.930 0.005 85)`    | Grey means disabled            |
| `--surface-anchor`      | `oklch(0.220 0.008 85)`    | Contrast anchor                |
| `--border-subtle`       | `oklch(0 0 0 / 0.08)`      |                                |
| `--border-default`      | `oklch(0 0 0 / 0.14)`      | Carries content to content-alt |
| `--border-strong`       | `oklch(0 0 0 / 0.24)`      |                                |
| `--input-border`        | `oklch(0 0 0 / 0.18)`      | Carries content to input       |
| `--input-border-focus`  | `oklch(0.656 0.212 354.3)` | Tailwind's pink-500            |
| `--fg-primary`          | `oklch(0.230 0.010 85)`    | Body text                      |
| `--fg-secondary`        | `oklch(0.440 0.008 85)`    | Anything that carries meaning  |
| `--fg-muted`            | `oklch(0.560 0.008 85)`    | Disabled labels only           |
| `--fg-placeholder`      | `oklch(0.545 0.008 85)`    | Inputs only, at a full 4.5:1   |
| `--fg-on-anchor`        | `oklch(0.960 0.004 85)`    | Anchor only                    |
| `--accent`              | `oklch(0.592 0.218 0.6)`   | Tailwind's pink-600            |
| `--accent-hover`        | `oklch(0.525 0.199 4)`     | pink-700                       |
| `--accent-fg`           | `oklch(1.000 0 0)`         | White                          |

Light mode role tokens keep a small non-zero chroma at hue 85, a warm grey,
except where a value is pure white.

### Dark mode

| Token                   | Value                      | Step                          |
| ----------------------- | -------------------------- | ----------------------------- |
| `--surface-canvas`      | `oklch(0.145 0 0)`         | neutral-950, base             |
| `--surface-content`     | `oklch(0.205 0 0)`         | neutral-900, +0.060           |
| `--surface-content-alt` | `oklch(0.269 0 0)`         | neutral-800, +0.064           |
| `--surface-input`       | `oklch(0.145 0 0)`         | neutral-950, -0.060           |
| `--surface-well`        | `oklch(0.145 0 0)`         | neutral-950, -0.060           |
| `--surface-float`       | `oklch(0.321 0 0)`         | `#333333`, +0.052             |
| `--surface-disabled`    | `oklch(0.205 0 0)`         | neutral-900, +0.060 on input  |
| `--surface-anchor`      | `oklch(0.205 0 0)`         | neutral-900, +0.060 on canvas |
| `--border-subtle`       | `oklch(1 0 0 / 0.08)`      |                               |
| `--border-default`      | `oklch(1 0 0 / 0.14)`      |                               |
| `--border-strong`       | `oklch(1 0 0 / 0.24)`      |                               |
| `--input-border`        | `oklch(1 0 0 / 0.20)`      |                               |
| `--input-border-focus`  | `oklch(0.656 0.212 354.3)` | pink-500                      |
| `--fg-primary`          | `oklch(0.970 0 0)`         | neutral-100                   |
| `--fg-secondary`        | `oklch(0.715 0 0)`         | neutral-400                   |
| `--fg-muted`            | `oklch(0.556 0 0)`         |                               |
| `--fg-placeholder`      | `oklch(0.600 0 0)`         | Lighter than neutral-500      |
| `--fg-on-anchor`        | `oklch(0.970 0 0)`         |                               |
| `--accent`              | `oklch(0.592 0.218 0.6)`   | pink-600, as in light mode    |
| `--accent-hover`        | `oklch(0.525 0.199 4)`     | pink-700                      |
| `--accent-fg`           | `oklch(1.000 0 0)`         | White                         |

Dark mode is Tailwind's neutral scale exactly, chroma zero, because the layout
is copied from a reference written in it. Two values depart from the
reference, and both for contrast: the float is `#333333` rather than
neutral-700, because `--fg-secondary` on neutral-700 is 4.12:1 and on
`#333333` it is 5.01:1; and the placeholder is lighter than the reference's
neutral-500, which measures 4.18:1 on the input.

### About the accent

The accent is Tailwind's pink-600, the reference's active colour, in both
modes: the active tool, the primary button, the current step. White on it is
4.60:1.

Hover on the role token goes **darker**, to pink-700 (6.04:1), in both modes,
rather than lighter to pink-500. White on pink-500 is 3.53:1, and the accent's
foreground has to stay readable while the pointer is on it. The studio
layout's own buttons hover to pink-500 because the reference does; the role
token keeps the stricter value.

### Shadows

Light mode: alpha 0.06 to 0.16, wide, small vertical offset. This is a real
separation mechanism, and the only thing holding `--surface-float` apart from
the white beneath it.

Dark mode: alpha 0.40 to 0.60, and permitted only on `--surface-float`, which
also clears its lightness step. Everywhere else a shadow is decoration. The
check will not accept a dark pair that relies on one.

The studio layout's coloured shadows, such as `shadow-md shadow-pink-600/20`
under the active tool, are Tailwind's scale recoloured, and are decoration.

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

### Severity

Four marker colours for a notification's icon: `--severity-info`,
`--severity-success`, `--severity-warning` and `--severity-error`. They are not
surfaces and not general foregrounds, and they only ever paint a glyph, so the
rule that applies is WCAG 1.4.11's 3:1 for a non-text graphic. Every one clears
4.5:1 on `--surface-float` anyway, in both modes, so a later change that puts
one on a word is already legal.

## Using the tokens

### Through Tailwind

```tsx
<div className="bg-neutral-900/40 border border-neutral-800 text-neutral-300">
<p className="text-xs text-fg-secondary">
```

| Class                                                                                                                                                                      | Token                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `bg-neutral-950` to `bg-neutral-50`, with any opacity modifier                                                                                                             | `--neutral-*`                  |
| `bg-studio-home`, `bg-studio-home-side`, `bg-studio-card`                                                                                                                  | the home-screen greys          |
| `bg-pink-600`, `text-sky-400`, `border-purple-500/80` and the rest                                                                                                         | Tailwind's fixed accent scales |
| `bg-surface-canvas`, `bg-surface-content`, `bg-surface-content-alt`, `bg-surface-input`, `bg-surface-well`, `bg-surface-float`, `bg-surface-disabled`, `bg-surface-anchor` | the surfaces                   |
| `text-fg-primary`, `text-fg-secondary`, `text-fg-muted`, `text-fg-placeholder`, `text-fg-on-anchor`                                                                        | the text tokens                |
| `bg-accent`, `bg-accent-hover`, `text-accent-fg`                                                                                                                           | the accent                     |
| `border-line-subtle`, `border-line`, `border-line-strong`, `border-line-input`, `border-line-focus`                                                                        | the borders                    |
| `rounded`, `rounded-xl`, `rounded-full` and Tailwind's other radii                                                                                                         | Tailwind's radius scale        |
| `rounded-window`                                                                                                                                                           | the window corner              |
| `bg-danger`, `text-danger-fg`                                                                                                                                              | the Windows close button's red |

A bare `border` with no colour takes `--border-default`.

### Nesting

**A card inside a card uses `--surface-content-alt` and a full-strength
border.** Two `--surface-content` elements inside each other have no boundary at
all in light mode, where both are white.

**Two levels of nesting is the limit.** Past that, separate with whitespace or a
rule rather than another surface.

```
canvas -> content (card) -> content-alt (nested card) -> whitespace
```

Inputs and wells are not nesting levels. An input goes on any content surface
and is separated by its own border; a well goes inside a content surface and
carries no text.

### Dropdowns and menus

Everything that floats above the interface, the select, the combo box, the
notification list and the command palette, is built on one `Overlay`
component, and every one of them closes the same way: Escape closes the top
one, and a press outside it does not reach what was underneath. Why those
controls are written rather than native is
[ADR 0010](../architecture/decisions/0010-custom-overlay-controls.md).

## Common mistakes

**Writing a `dark:` variant.** The neutral scale inverts itself in light mode.
A `dark:` class is a second answer to a question the variables already
answered, and the two drift.

**Mixing the neutral scale with a fixed colour for text on a neutral ground.**
The neutral scale inverts; `white` and `black` do not. `text-neutral-100` on
`bg-neutral-950` reads in both modes, and `text-white` on `bg-neutral-950` is
white on near white in light mode. Fixed white belongs on the fixed accents,
such as the pink active tool.

**Using an accent for decoration.** Pink means active, sky means on, purple
means layers. A decorative pink makes the active tool harder to find.

**Using a symmetric lightness ladder in both modes for the role tokens.**
Stepping up in lightness from a grey canvas gives you more grey, so every card
and every input ends up grey. Light mode separates content surfaces by border
and shadow; only dark mode uses a lightness ladder. See
[ADR 0009](../architecture/decisions/0009-asymmetric-surface-model.md).

**Checking contrast only against the foregrounds a surface is expected to
carry.** A check built from expectations can only confirm what someone already
thought of. The script discovers the tokens from the file and measures the
whole matrix; a pair that fails must be declared unused or exempt.

**Assuming Tailwind picks up a new token while the dev server is running.** It
does not. After changing `tailwind.config.ts`, restart the dev server. Until
then the class simply does not exist, the element has no background at all,
and it looks exactly like a broken token rather than a missing class.

**Making a surface translucent so that the background effect shows through it.**
A translucent surface ends up somewhere between its own value and the user's
wallpaper, and no check can predict where. The frame is opaque.

**Using `--fg-muted` for anything but a disabled control.** It does not clear
4.5:1, and the WCAG exemption that allows it covers disabled controls only.

**Writing a hex colour in a component.** It will not follow the theme, and no
check will ever look at it. A test scans every source file and allows literal
colours only in `tokens.css`.

**Putting text on `--surface-well`.** It is decorative. The script will fail if
the well is ever listed as text-bearing.

## Verifying

```bash
npm run check:contrast
```

Reading the output is covered in [Theming](theming.md).
