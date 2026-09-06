# 5. Define colour tokens in OKLCH with enforced elevation steps

Date: 2026-02-03

## Status

Superseded by [0009](0009-asymmetric-surface-model.md).

The choice of OKLCH stands, and so does the idea that separation should be a
number a script checks. What 0009 replaces is the surface model: the symmetric
lightness ladder described below made every light-mode surface grey, and
therefore put every piece of text in the application on grey. The record is kept
because the reasoning about perceptual uniformity, about the light-mode ceiling,
and about shadows being invisible in dark mode is what 0009 is built on.

## Context

The interface layers surfaces: a canvas, panels on it, cards on those, wells
sunk below. A layer is legible only if the eye can separate it from the one it
touches. Getting that right by eye, in two themes, is unreliable, and getting it
wrong is not obvious until someone with a different monitor says the cards have
disappeared.

The usual approach is HSL and a designer's judgement. HSL has a specific defect
here: its L channel is not perceived lightness. `hsl(60 100% 50%)` and
`hsl(240 100% 50%)` claim the same lightness, and the yellow is roughly ten
times as bright as the blue. Two greys with the same HSL L can look plainly
different. So a rule written in HSL cannot be checked, and one that cannot be
checked is a comment.

OKLCH does not have that defect. Its L is perceptually uniform, so a difference
of 0.05 L means about the same amount of visible separation anywhere in the
range. That makes a numeric threshold meaningful, and therefore testable.

Three more things came out of building the palette.

**Neither extreme can be the canvas.** With the canvas at white there is nowhere
above it; with it at black there is nowhere below. Both extremes have to stay
free, so the canvas sits at 0.905 in light mode and 0.200 in dark.

**Dark mode needs a bigger step.** The eye separates dark values less well than
light ones. A 0.040 step that is clear at L 0.9 is marginal at L 0.2. Dark mode
was set to 0.050.

**Light mode has room for fewer steps.** Light mode is capped at L 1.0, and the
canvas has to sit low enough to leave room below for the sunken layer. What
remains above the canvas is about 0.09 L. Two steps fit; five would be about
0.018 apart, which is invisible. Dark mode has the whole range from 0.15 to
0.36 and fits five comfortably.

Forcing symmetry would mean either crushing the light steps together or
stretching the dark ones apart. Both are worse than accepting that the two modes
are not mirror images.

The final asymmetry is separation itself. In light mode a shadow reads clearly.
In dark mode a shadow against a dark ground is close to invisible, which is
where the classic mistake lives: carry the light-mode shadow system across to
dark, see it in the CSS, and assume separation is handled.

## Decision

All colour is defined in `apps/desktop/src/styles/tokens.css`, in OKLCH.

Rules, enforced by `scripts/check-contrast.ts`:

1. Adjacent surfaces differ by at least **0.040 L** in light mode and
   **0.050 L** in dark.
2. Higher layers are lighter in both modes; sunken layers are darker than the
   canvas in both. The direction never flips between themes.
3. Every text token clears WCAG on every surface it is declared for: 4.5:1 for
   body text, 3:1 for large. The declared pairings are a list in the script,
   so using a foreground on an undeclared surface is a bug even if it happens
   to pass.
4. Both modes declare the same set of colour tokens.

Deliberate asymmetries, documented rather than smoothed over:

- **Light mode has four surface steps, dark mode has five.** The light floating
  layer shares surface-2's lightness and is separated by shadow, which is the
  one separation no numeric check covers.
- **Dark mode never relies on shadow.** Every dark boundary is carried by a
  lightness step and a hairline border.

Neutrals keep a small non-zero chroma at hue 85, a warm grey. Chroma of exactly
zero reads as dead, and slightly blue, on most displays.

Opacity is never used to de-emphasise a container. A faded container lets the
layer beneath bleed through and breaks the elevation order, so disabled states
use `--surface-disabled` and `--fg-muted` instead.

## Consequences

Positive:

- The elevation rule is a number a script checks, and CI blocks a merge that
  breaks it. It cannot rot the way a written guideline does.
- The contrast table is explicit, so a pairing nobody reviewed cannot appear by
  accident.
- Perceptual uniformity means a token can be adjusted without re-checking every
  other pairing by hand.
- The light and dark palettes are one system with two value sets, not two
  designs.

Negative:

- OKLCH needs a modern engine. WebKitGTK 4.1 and current WebView2 and WKWebView
  all support it; an older Linux webview does not, and there is no fallback.
- Contributors have to work in a space most tooling still does not default to,
  and an OKLCH picker is a less familiar tool than a hex field.
- The four-versus-five asymmetry surprises people, which is why it is called
  out in the design system document and in the token file itself.
- The pairing table has to be updated when a new foreground and surface
  combination is introduced. That is the point, and it is still friction.

Neutral:

- Tailwind's own palette is removed rather than extended, so `bg-gray-800` does
  not exist as a class. A stock palette colour would sit outside the elevation
  system and outside these checks.
- A second, translucent token set exists for when a platform background effect
  is active. It is selected by an attribute the shell sets, never by a guess.
  See [decision 0006](0006-custom-window-decorations.md).
