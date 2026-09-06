# Theming

How to change a colour, add a theme, and read the output of the contrast check.

The rules behind the tokens are in [the design system](design-system.md). This
page is the mechanics.

## Where the colour lives

| File | Contains |
| --- | --- |
| `apps/desktop/src/styles/tokens.css` | Every colour, both themes, both token sets |
| `apps/desktop/tailwind.config.ts` | The mapping from tokens to Tailwind classes |
| `apps/desktop/src/styles/global.css` | Base styles and the checkerboard pattern |
| `scripts/check-contrast.ts` | The checks and the declared text pairings |

`tokens.css` is the only file allowed to define a colour value. Everything else
refers to a token.

## How a theme is selected

The root element carries three attributes:

```html
<html data-theme="dark" data-platform="windows" data-vibrancy="off">
```

| Attribute | Values | Set by |
| --- | --- | --- |
| `data-theme` | `dark`, `light` | The shell store, from the user's choice |
| `data-platform` | `macos`, `windows`, `linux` | The shell store, from `platform_info` |
| `data-vibrancy` | `on`, `off` | The shell store, from `vibrancy_state` |

CSS decides what those mean. Nothing in a component sets a colour directly, and
`applyRootAttributes` in `useShellStore.ts` is the only code that writes them.

`data-theme` is applied in `main.tsx` before React mounts, so the window never
flashes in the wrong palette.

`data-vibrancy` comes from Rust and is never inferred. Opaque is the default and
the safe one; see
[decision 0006](../architecture/decisions/0006-custom-window-decorations.md).

## Changing a colour

1. Edit the token in `tokens.css`, in OKLCH.
2. Run `npm run check:contrast`.
3. Fix anything it reports.
4. Run the application and look at both themes.

A surface change usually needs its neighbours moved too, because the step is
measured between adjacent surfaces. Raising surface-1 without raising surface-2
narrows the gap above it.

### Picking a value

OKLCH is `oklch(L C H)`:

| Channel | Range | Meaning |
| --- | --- | --- |
| L | 0 to 1 | Perceived lightness |
| C | 0 to about 0.4 | Chroma, or saturation |
| H | 0 to 360 | Hue |

Neutrals here use hue 85, a warm grey, with a small non-zero chroma. Chroma of
exactly zero reads as dead, and slightly blue, on most displays.

[oklch.com](https://oklch.com) is a usable picker that shows the sRGB gamut
boundary, which matters: a high chroma at a high L falls outside sRGB and gets
clipped by the browser.

## Adding a theme

Themes are attribute-selected, so a third is a new block.

### 1. Add the block

In `tokens.css`, after the dark block:

```css
[data-theme='high-contrast'] {
  --surface-sunken: oklch(0.05 0 0);
  --surface-canvas: oklch(0.12 0 0);
  --surface-1: oklch(0.2 0 0);
  --surface-2: oklch(0.28 0 0);
  --surface-float: oklch(0.36 0 0);
  /* every colour token from the dark block */
}
```

Every colour token, not a subset. A token declared in one theme and missing from
another falls back to the `:root` value, which will be from the wrong palette.

### 2. Register it in the store

In `useShellStore.ts`:

```typescript
export type Theme = 'dark' | 'light' | 'high-contrast';
```

Then add it to the theme selector in `SettingsScreen.tsx`, and add its label to
`common.json` under `theme` in **every** locale.

### 3. Teach the check about it

`scripts/check-contrast.ts` reads two blocks. Add the third:

```typescript
const BLOCKS = {
  light: ':root {',
  dark: "[data-theme='dark'] {",
  highContrast: "[data-theme='high-contrast'] {",
} as const;
```

Then give it a minimum step in `MIN_STEP` and an adjacency list in `ADJACENT`.
A dark theme uses the dark values: 0.050, and five steps.

### 4. Add the translucent set, if the theme is used with vibrancy

```css
[data-vibrancy='on'][data-theme='high-contrast'] {
  --surface-canvas: transparent;
  --surface-1: oklch(0.2 0 0 / 0.74);
  --surface-2: oklch(0.28 0 0 / 0.86);
  --surface-float: oklch(0.36 0 0 / 0.94);
}
```

Keep every alpha that carries text at 0.85 or above.

### 5. Verify

```bash
npm run check:contrast
npm run test
```

## Reading the check output

```
LIGHT MODE

  Elevation steps (minimum 0.040 L)
    pass  --surface-sunken -> --surface-canvas       0.045
    pass  --surface-canvas -> --surface-1            0.045
    pass  --surface-1 -> --surface-2                 0.040

  Text contrast
    pass  --fg-primary on --surface-canvas           12.06:1 (body, needs 4.5:1)
    pass  --fg-muted on --surface-1                  3.28:1 (large, needs 3:1)
    skip  --fg-muted on --surface-disabled           3.04:1 (disabled controls are exempt)

  Token parity
    pass  both modes declare 17 colour tokens

All checks passed.
```

Three sections per mode:

**Elevation steps** is the lightness difference between surfaces that touch. A
failure names the pair and how far short it falls:

```
[dark] elevation: --surface-1 -> --surface-2 is 0.032 L, short by 0.018
```

Fix it by moving one of the two, and check the neighbour on the other side of
whichever you moved.

**Text contrast** is the WCAG ratio for each declared pairing. `body` needs
4.5:1, `large` needs 3:1. A failure means either the foreground or the surface
has to move:

```
[light] contrast: --fg-secondary on --surface-canvas is 3.90:1, short of 4.5:1 for body text
```

Darkening a foreground in light mode, or lightening it in dark mode, is usually
the smaller change. Moving a surface affects its elevation steps as well.

`skip` lines are the documented exemptions.

**Token parity** compares the colour tokens declared in each mode. The radius,
spacing, and layout scales are the same in both modes by design and are declared
once, so they are not compared.

## Adding a text pairing

Using an existing foreground on a surface it is not declared for means adding
the pairing to `TEXT_ON` in `scripts/check-contrast.ts`:

```typescript
{ fg: '--fg-muted', bg: '--surface-canvas', size: 'large' },
```

The check then measures it in every mode. If it fails, the pairing is not
allowed, and the fix is a different token rather than a suppression.

Not adding it is worse than adding a failing one: an unreviewed pairing is one
nobody has measured.

## Checklist

Before opening a pull request that touches colour:

- [ ] `npm run check:contrast` passes.
- [ ] `npm run test` passes, including the token discipline test.
- [ ] Both themes look right in the running application.
- [ ] The boundary between canvas, panel, and card is visible without effort in
      both themes.
- [ ] With vibrancy off, the interface still reads correctly.
- [ ] With vibrancy on, no text sits on a translucent surface.
- [ ] No hex, `rgb()`, or `hsl()` anywhere outside `tokens.css`.
