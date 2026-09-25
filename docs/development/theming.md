# Theming

How to change a colour, add a theme, and read the output of the contrast check.

The rules behind the tokens are in [the design system](design-system.md). This
page is the mechanics.

## Where the colour lives

| File                                   | Contains                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `apps/desktop/src/styles/tokens.css`   | Every colour, both themes, plus the radius, shadow and spacing scales     |
| `apps/desktop/tailwind.config.ts`      | The mapping from tokens to Tailwind classes, and nothing from its palette |
| `apps/desktop/src/styles/global.css`   | Base styles, the bezel and the checkerboard patterns                      |
| `apps/desktop/src/test/tokens.test.ts` | The token discipline test: no literal colour, no palette class            |
| `scripts/check-contrast.ts`            | The checks and the declared text pairings                                 |

`tokens.css` is the only file allowed to define a colour value. Everything else
refers to a token. `colors` in `tailwind.config.ts` replaces Tailwind's default
palette rather than extending it, so a class such as `bg-neutral-900` or
`text-pink-400` does not exist, and `tokens.test.ts` fails if one is written
anywhere in `src`. The layout of the studio is the reference's; its look is
these tokens, as [the studio style](../architecture/studio-style.md) maps them.

## How a theme is selected

The root element carries three attributes:

```html
<html data-theme="dark" data-platform="windows" data-vibrancy="off"></html>
```

| Attribute       | Values                      | Set by                                                                       |
| --------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `data-theme`    | `dark`, `light`             | The shell store, from the user's choice; `system` resolves to one of the two |
| `data-platform` | `macos`, `windows`, `linux` | The shell store, from `platform_info`                                        |
| `data-vibrancy` | `on`, `off`                 | The shell store, from `vibrancy_state`                                       |

CSS decides what those mean. Nothing in a component sets a colour directly, and
`applyRootAttributes` in `useShellStore.ts` is the only code that writes them.

`data-theme` is applied in `main.tsx` before React mounts, so the window never
flashes in the wrong theme.

`data-vibrancy` comes from Rust and is never inferred. With it on, the bezel
turns transparent and the platform's Mica or vibrancy shows there; everything
inside the bezel stays opaque either way. Opaque is the default and the safe
one; see [the bezel](design-system.md#the-bezel) and
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

A colour the interface needs and no token names is a new token, in both
blocks, not a Tailwind palette class and not a literal in a component.

### Picking a value

OKLCH is `oklch(L C H)`:

| Channel | Range          | Meaning               |
| ------- | -------------- | --------------------- |
| L       | 0 to 1         | Perceived lightness   |
| C       | 0 to about 0.4 | Chroma, or saturation |
| H       | 0 to 360       | Hue                   |

Neutrals here use hue 85, a warm grey, with a small non-zero chroma, in both
modes. Chroma of exactly zero reads as dead, and slightly blue, on most
displays. The accent is yellow, at hue 105.

[oklch.com](https://oklch.com) is a usable picker that shows the sRGB gamut
boundary, which matters: a high chroma at a high L falls outside sRGB and gets
clipped by the browser.

## Adding a theme

Themes are attribute-selected, so a third is a new block.

### 1. Add the block

In `tokens.css`, after the dark block, declaring every colour token. A token
declared in one theme and missing from another falls back to the `:root` value,
which will be from the wrong theme.

Decide first which separation model the theme follows. A light theme separates
content surfaces by border and shadow; a dark theme separates them by a
lightness step of at least 0.050. That choice drives every value in the block.

Every surface stays opaque. The background effect is shown by the bezel, not by
a translucent surface.

### 2. Register it in the store

In `useShellStore.ts`, add it to the `Theme` union and `THEMES`, then to the
theme selector in `SettingsScreen.tsx`, and add its label to `common.json`
under `theme` in **every** locale.

### 3. Teach the check about it

`scripts/check-contrast.ts` reads two blocks. Add the third to `BLOCK_START` and
to `MODES`, and give it a minimum step in `MIN_STEP`. The adjacency list comes
from the `@separation` declarations and does not need changing, but a light-like
theme has to satisfy the declared mechanism while a dark-like theme has to
satisfy the lightness rule.

### 4. Verify

```bash
npm run check:contrast
npm run test
```

## Reading the check output

```
Bitwright colour token check
Discovered 6 foreground and 9 surface tokens, and 7 declared adjacencies.

LIGHT MODE

  Surface separation (the declared mechanism, lightness minimum 0.040 L)
    pass  canvas > content                       lightness  0.070 of 0.040
    pass  content > input                        border     --input-border at 0.18 of 0.14
    pass  content-alt > float                    shadow     --shadow-md at 0.12 of 0.06

  Pairs that may never be waived
    pass  --fg-placeholder on --surface-input          4.96:1, needs 4.5:1

  Text contrast, every foreground on every text-bearing surface
                          canvas     content content-alt       input       float    disabled      anchor      accent
    primary                 13.7        16.9        15.7        16.9        16.9        13.7         n/a        11.9
    muted                    n/a         4.7         n/a         4.7         4.7        wcag         n/a         n/a
    n/a = declared unused in EXEMPT, wcag = disabled control exemption

TOKEN PARITY
  pass  both modes declare 25 colour tokens

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
- [ ] With vibrancy off, the bezel is the anchor colour and the interface still
      reads correctly; with it on, only the bezel lets the effect through.
- [ ] In light mode, the boundary between two white surfaces is visible through
      its border or its shadow.
- [ ] A disabled control looks clearly different from an enabled one.
- [ ] No Tailwind palette class (`neutral-*`, `pink-*`, `sky-*`, `white` and
      the rest) and no coloured shadow anywhere in `src`.
- [ ] No hex, `rgb()`, or `hsl()` anywhere in `src` outside `tokens.css`.
- [ ] No text under 11px.
