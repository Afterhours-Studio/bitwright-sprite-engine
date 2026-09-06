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

In dark mode a surface change usually needs its neighbours moved too, because
the step is measured between adjacent surfaces: raising `--surface-content`
without raising `--surface-content-alt` narrows the gap above it.

In light mode that is mostly not true, because content surfaces are separated by
border and shadow rather than by lightness. There the thing to check is that the
border or shadow named in the `@separation` declaration is still strong enough.

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

In `tokens.css`, after the dark block, declaring every colour token. A token
declared in one theme and missing from another falls back to the `:root` value,
which will be from the wrong palette.

Decide first which separation model the theme follows. A light theme separates
content surfaces by border and shadow; a dark theme separates them by a
lightness step of at least 0.050. That choice drives every value in the block.

### 2. Register it in the store

In `useShellStore.ts`, add it to the `Theme` union, then to the theme selector
in `SettingsScreen.tsx`, and add its label to `common.json` under `theme` in
**every** locale.

### 3. Teach the check about it

`scripts/check-contrast.ts` reads two blocks. Add the third to `BLOCK_START` and
to `MODES`, and give it a minimum step in `MIN_STEP`. The adjacency list comes
from the `@separation` declarations and does not need changing, but a light-like
theme has to satisfy the declared mechanism while a dark-like theme has to
satisfy the lightness rule.

### 4. Add the translucent variant, if the theme is dark

Keep every alpha at or above 0.90, so that the declared steps survive
compositing against an unknown wallpaper, and leave `--surface-content` opaque.

### 5. Verify

```bash
npm run check:contrast
npm run test
```

## Reading the check output

```
Bitwright colour token check
Discovered 5 foreground and 8 surface tokens, and 7 declared adjacencies.

LIGHT MODE

  Surface separation (the declared mechanism, lightness minimum 0.040 L)
    pass  canvas > content       lightness  0.070 of 0.040
    pass  content > input        border     --input-border at 0.18 of 0.14
    pass  content-alt > float    shadow     --shadow-md at 0.12 of 0.06

  Pairs that may never be waived
    pass  --fg-placeholder on --surface-input     4.96:1, needs 4.5:1

  Text contrast, every foreground on every text-bearing surface
                      canvas   content   input   disabled   anchor   accent
    primary             13.7      16.9    16.9       13.7      n/a     11.9
    muted                n/a       4.7     4.7       wcag      n/a      n/a
    n/a = declared unused in EXEMPT, wcag = disabled control exemption

TOKEN PARITY
  pass  both modes declare 21 colour tokens

All checks passed.
```

Four sections.

**Surface separation** checks each declared adjacency. In light mode it verifies
the mechanism the declaration names; in dark mode it ignores the mechanism and
requires the lightness step, because nothing else works there. A failure names
the pair, the mechanism, and how far short it falls:

```
[dark] separation: content > content-alt is 0.032 L, short by 0.018
[light] separation: content > input declares border --input-border, whose alpha 0.10 is below 0.14
```

**Pairs that may never be waived** is a short list that no exemption can cover.
Placeholder text on an input is the first entry, because it is the pair the
previous version of this script missed entirely.

**Text contrast** is the full matrix: every foreground against every surface
that is allowed to carry text. A cell is a ratio when it passes, `n/a` when the
pairing is declared unused, `wcag` for the one disabled-control exemption, and
`FAIL` otherwise.

A failing cell means one of two things. Either the pairing is real, and a token
has to move, or the pairing does not occur and the script has not been told.
Both are decisions; neither is a suppression.

**Token parity** compares the colour tokens declared in each mode. Radius,
spacing, and layout scales are declared once and are not compared.

## Adding a text pairing

There is no list of allowed pairings to add to. The script measures everything,
so using an existing foreground somewhere new is checked automatically the next
time it runs.

What you may have to change is the opposite: if the script reports a failure for
a pairing that does not occur in the interface, add it to `EXEMPT` in
`scripts/check-contrast.ts` with `kind: 'unused'` and a reason.

```typescript
...outOfScope('--fg-placeholder', ['--surface-anchor']),
```

That list is how each token's scope is enforced rather than merely documented.
Marking a pairing unused when it does occur is the one way to defeat the check,
so it is worth being sure.

Adding a new token forces this too: every one of its pairings is measured, and
the failures have to be classified before the check will pass.

## Checklist

Before opening a pull request that touches colour:

- [ ] `npm run check:contrast` passes.
- [ ] `npm run test` passes, including the token discipline test.
- [ ] Both themes look right in the running application.
- [ ] The boundary between canvas, panel, and card is visible without effort in
      both themes.
- [ ] With vibrancy off, the interface still reads correctly.
- [ ] With vibrancy on, no text sits on a surface below 0.90 alpha.
- [ ] In light mode, the boundary between two white surfaces is visible through
      its border or its shadow.
- [ ] A disabled control looks clearly different from an enabled one.
- [ ] No hex, `rgb()`, or `hsl()` anywhere outside `tokens.css`.
