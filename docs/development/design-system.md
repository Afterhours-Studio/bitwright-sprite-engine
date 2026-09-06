# Design system

The rules the interface's colour and elevation follow, the full token table, and
the mistakes these rules exist to prevent.

All colour is defined once, in `apps/desktop/src/styles/tokens.css`, and
verified by `scripts/check-contrast.ts`.

## Principles

### 1. The canvas is never pure white or pure black

In light mode the application background is a mid grey, not `#FFFFFF`. In dark
mode it is a dark grey, not `#000000`.

The reason is structural. If the canvas sits at an extreme there is nowhere left
to go: a layer above white cannot be lighter, and a well below black cannot be
darker. Both extremes are reserved as accents, and the canvas sits where it has
room in both directions.

### 2. Elevation runs one way, in both modes

Higher layers are **lighter** than the layer beneath. Sunken layers are
**darker** than the canvas. This does not flip between themes.

Inverting the direction in dark mode is tempting, since dark surfaces often
carry lighter panels in other systems, but a user who switches themes then has
to relearn which way is up. The direction stays fixed.

### 3. Adjacent surfaces differ by a minimum lightness step

Two surfaces that touch must differ by at least:

| Mode | Minimum step |
| --- | --- |
| Light | 0.040 L |
| Dark | 0.050 L |

In OKLCH, where L is perceived lightness, so the number means the same amount of
visible separation anywhere in the range.

Dark mode needs the larger step because the eye separates dark values less well.
A 0.040 difference that is obvious at L 0.9 is marginal at L 0.2.

This is a hard threshold. `scripts/check-contrast.ts` fails the build below it.

### 4. The two modes have different numbers of steps

**Light mode has four surface steps. Dark mode has five.**

Light mode is capped at L 1.0. Once the canvas sits low enough to leave room for
a sunken layer beneath it, about 0.09 L remains above it. Two steps fit there.
Five would be about 0.018 apart, which is invisible.

Dark mode has the range from 0.15 to 0.36 and fits five comfortably.

In light mode the floating layer therefore shares surface-2's lightness and is
separated by a **stronger shadow** instead. That is the one separation no
numeric check covers, so it is stated here and in the token file.

This asymmetry is deliberate. Forcing symmetry would mean crushing the light
steps together or stretching the dark ones apart, and both are worse.

### 5. Separation comes from three sources, and they are not interchangeable

Every boundary between two surfaces must be carried by at least one of:
lightness difference, a border, or a shadow.

Which of them work depends on the mode, and this is where the classic mistake
lives:

| Mode | Shadow | Border | Lightness |
| --- | --- | --- | --- |
| Light | Works well | Optional, can be hairline | Works well |
| Dark | **Nearly invisible** | **Required** | **Required** |

A shadow against a dark ground barely registers. Carrying the light mode shadow
system into dark mode, seeing it in the CSS, and assuming separation is handled
is the single easiest way to produce a dark theme where the cards have
disappeared.

**In dark mode, always use a lightness step and a hairline border. Never rely on
a shadow.**

### 6. Opacity is never used to de-emphasise a container

A faded container lets whatever is beneath it bleed through, which breaks the
elevation order that everything else depends on. A disabled card at 50 percent
opacity over surface-1 is a colour that exists in no token.

Use the tokens instead:

- `--surface-disabled` for the background of a disabled control.
- `--fg-muted` for de-emphasised text.

Opacity is for motion, and for a full-screen overlay.

## Tokens

### Light mode

| Token | Value | Step | Used for |
| --- | --- | --- | --- |
| `--surface-sunken` | `oklch(0.860 0.006 85)` | -0.045 | Tracks, wells, inputs |
| `--surface-canvas` | `oklch(0.905 0.005 85)` | base | Application background |
| `--surface-1` | `oklch(0.950 0.004 85)` | +0.045 | Panels, sidebar, title bar |
| `--surface-2` | `oklch(0.990 0.003 85)` | +0.040 | Cards, dialogs |
| `--surface-float` | `oklch(0.990 0.003 85)` | shadow | Popovers, dropdowns |
| `--surface-disabled` | `oklch(0.925 0.004 85)` | - | Disabled controls |
| `--border-subtle` | `oklch(0 0 0 / 0.08)` | - | Hairlines |
| `--border-default` | `oklch(0 0 0 / 0.14)` | - | Standard borders |
| `--border-strong` | `oklch(0 0 0 / 0.24)` | - | Emphasis |
| `--fg-primary` | `oklch(0.250 0.010 85)` | - | Body text |
| `--fg-secondary` | `oklch(0.450 0.008 85)` | - | Supporting text |
| `--fg-muted` | `oklch(0.610 0.006 85)` | - | Large or de-emphasised text |
| `--accent` | `oklch(0.880 0.190 105)` | - | Active state |
| `--accent-hover` | `oklch(0.845 0.190 105)` | - | Accent hover, darker |
| `--accent-fg` | `oklch(0.220 0.030 105)` | - | Text on accent |
| `--anchor` | `oklch(0.220 0.008 85)` | - | Status bar |
| `--anchor-fg` | `oklch(0.960 0.004 85)` | - | Text on the status bar |

### Dark mode

| Token | Value | Step | Used for |
| --- | --- | --- | --- |
| `--surface-sunken` | `oklch(0.150 0.008 85)` | -0.050 | Tracks, wells, inputs |
| `--surface-canvas` | `oklch(0.200 0.008 85)` | base | Application background |
| `--surface-1` | `oklch(0.250 0.009 85)` | +0.050 | Panels, sidebar, title bar |
| `--surface-2` | `oklch(0.300 0.010 85)` | +0.050 | Cards, dialogs |
| `--surface-float` | `oklch(0.355 0.011 85)` | +0.055 | Popovers, dropdowns |
| `--surface-disabled` | `oklch(0.225 0.008 85)` | - | Disabled controls |
| `--border-subtle` | `oklch(1 0 0 / 0.08)` | - | Hairlines |
| `--border-default` | `oklch(1 0 0 / 0.14)` | - | Standard borders |
| `--border-strong` | `oklch(1 0 0 / 0.24)` | - | Emphasis |
| `--fg-primary` | `oklch(0.960 0.004 85)` | - | Body text |
| `--fg-secondary` | `oklch(0.750 0.006 85)` | - | Supporting text |
| `--fg-muted` | `oklch(0.580 0.008 85)` | - | Large or de-emphasised text |
| `--accent` | `oklch(0.850 0.170 105)` | - | Active state |
| `--accent-hover` | `oklch(0.885 0.180 105)` | - | Accent hover, lighter |
| `--accent-fg` | `oklch(0.180 0.030 105)` | - | Text on accent |
| `--anchor` | `oklch(0.120 0.006 85)` | - | Status bar |
| `--anchor-fg` | `oklch(0.940 0.004 85)` | - | Text on the status bar |

### About the accent

One saturated colour, used sparingly: the active navigation pill, the primary
button, and the single most important value on a screen. Used for decoration it
stops reading as a state.

Two details are easy to get wrong:

- **Dark mode lowers both L and chroma.** Yellow at full chroma on a dark ground
  reads as neon.
- **Hover moves away from the surface.** Darker in light mode, lighter in dark.
  A hover that moves toward the background reads as the control receding.

`--accent-fg` is dark in **both** modes. Yellow is far too light for white text;
the contrast never clears 4.5:1.

### Scales

```css
--radius-sm: 8px;    --radius-md: 14px;
--radius-lg: 20px;   --radius-pill: 999px;

--space-1: 4px; ... --space-12: 48px;   /* a 4px scale */

--titlebar-height: 40px;
--statusbar-height: 28px;
```

Shadows are wide, low opacity, and offset only slightly. A tight dark shadow
reads as a cheap drop shadow; a diffuse one reads as height.

In dark mode the shadow alphas rise to 0.30 to 0.50, and are used only as a hint
on the topmost layer. They never carry separation on their own.

### Which text goes on which surface

Enforced by `scripts/check-contrast.ts`. A pairing that is not listed is a bug
even if it happens to pass, because nobody reviewed it.

| Foreground | Cleared for | Size |
| --- | --- | --- |
| `--fg-primary` | Every surface | Body |
| `--fg-secondary` | Every surface | Body |
| `--fg-muted` | `--surface-disabled` only | Exempt |
| `--anchor-fg` | `--anchor` | Body |
| `--accent-fg` | `--accent`, `--accent-hover` | Body |

`--fg-muted` has exactly one legitimate use: **the label of a disabled
control**. It measures 3.28:1 on surface-1 in light mode, which is below the
4.5:1 body text needs, and WCAG 1.4.3 exempts disabled controls and nothing
else.

It is not a general de-emphasis token. Anything that tells the user something
uses `--fg-secondary`: status lines, descriptions, hints, placeholders, and the
reason an engine is unavailable. "No CUDA driver was found" is the whole point
of that part of the screen; a user who cannot read it does not know what to
install.

Because of that, `--fg-muted` appears nowhere in the checked pairings. It has
one entry, in the exemption list.

## Using the tokens

### Through Tailwind

Tailwind's own palette is **removed**, not extended. `bg-gray-800` is not a
class that exists, because a stock palette colour would sit outside the
elevation system and outside the contrast checks.

```tsx
<div className="bg-surface-2 text-fg-primary border border-line-subtle">
```

| Class | Token |
| --- | --- |
| `bg-surface-canvas`, `bg-surface-1`, `bg-surface-2`, `bg-surface-sunken` | the surfaces |
| `text-fg-primary`, `text-fg-secondary`, `text-fg-muted` | the text tokens |
| `bg-accent`, `text-accent-fg` | the accent |
| `bg-anchor`, `text-anchor-fg` | the status bar |
| `border-line-subtle`, `border-line`, `border-line-strong` | the borders |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill` | the radii |
| `shadow-sm`, `shadow-md`, `shadow-lg` | the shadows |

### Nesting

**Never nest two surfaces of the same step.** A card inside a panel means the
panel is surface-1 and the card is surface-2. Two surface-2 elements inside each
other have no boundary at all.

**Three steps is the limit.** Past that, separate with whitespace or a rule
rather than another step. Light mode does not have a fourth step to give.

```
canvas -> surface-1 (panel) -> surface-2 (card) -> whitespace, not surface-float
```

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

**Using pure white or pure black as a background.** There is then nowhere to go
in one direction. Both extremes are accents. See principle 1.

**Flipping the elevation direction in dark mode.** Higher is lighter in both
modes. A user switching themes should not have to relearn which way is up. See
principle 2.

**Steps under the threshold.** A 0.02 step looks fine on the monitor it was
designed on and disappears on a laptop in daylight. The check exists because
this is not reliably visible to the person making the change. See principle 3.

**Forcing five steps in light mode.** The top two collide. Light mode has four
and uses shadow for the floating layer. See principle 4.

**Carrying the light mode shadow system into dark mode.** The most common
mistake of the set. Shadows are nearly invisible on a dark ground. Dark mode
needs a lightness step and a border. See principle 5.

**Using opacity for a disabled state.** The layer beneath bleeds through and the
elevation order breaks. Use `--surface-disabled` and `--fg-muted`. See
principle 6.

**Writing a hex colour in a component.** It will not follow the theme, and no
check will ever look at it. ESLint rejects it, and a test scans for it.

**Adding a colour to one theme only.** The parity check fails.

**Assuming a translucent surface keeps its place in the elevation order.** It
does not. It ends up somewhere between its own value and the user's wallpaper,
and no check can predict where, because the wallpaper is not ours. This is why
the translucent set is dark mode only, and why it never touches
`--surface-content`.

**Using `--fg-muted` for anything but a disabled control.** It clears 3:1, not
4.5:1, and the WCAG exemption that allows it covers disabled controls only. A
hint, a status line, or the reason an engine cannot be selected is information
the user has to act on, and it belongs on `--fg-secondary`. This is the easiest
rule to break by accident, because muted text looks tidy and the check will not
catch it: the pairing is not in the table, so nothing measures it.

**Nesting two surfaces of the same step.** No boundary. Raise one, or separate
them with whitespace.

## Verifying

```bash
npm run check:contrast
```

Reading the output is covered in [Theming](theming.md).
