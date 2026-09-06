# 9. Separate surfaces by role, and by a different mechanism in each mode

Date: 2026-02-12

## Status

Accepted. Supersedes
[0005](0005-oklch-color-tokens.md).

## Context

ADR 0005 built a symmetric ladder. Both modes had a canvas, then `surface-1`,
then `surface-2`, each step lighter than the last by a checked amount, and
`scripts/check-contrast.ts` enforced the steps. The reasoning was sound and the
script passed.

The interface was still hard to read in light mode, and running it made the
reason obvious. Every step above a grey canvas is also grey. `surface-1` at
L 0.95 and `surface-2` at L 0.99 are both grey, so every card, every panel, and
every input was grey, and all of the text in the application sat on grey. The
ladder was doing exactly what it was designed to do, and the design was wrong.

The check did not catch it because the check was asking the wrong question. It
measured each surface against the foreground it was expected to carry, so the
answer was always about a pairing someone had already thought about. Text that
was hard to read in practice was text on a pairing nobody had listed. It never
listed `--fg-placeholder` at all, which is why placeholders were unreadable in
both modes while the script reported everything green.

Looking at what mature systems actually do settled the shape of the fix. GitHub
Primer, Atlassian, and Material 3 all use **two different mechanisms**:

- In light mode the canvas is grey and content surfaces are white. They are not
  separated from each other by lightness at all; they are separated by border
  and by shadow. There are effectively two lightness values: grey behind, white
  in front.
- In dark mode content surfaces step upward in real increments of five to eight
  percent luminance, and shadow is not used for separation, because against a
  dark ground it is not visible.

That is not an inconsistency to be tidied away. It follows from two facts. A
shadow is a dark shape, so it reads on a light ground and vanishes on a dark
one. And light mode is capped: there is no room above white for a five step
ladder, which ADR 0005 already discovered from the other direction when it had
to give light mode four steps and dark mode five.

## Decision

Three changes.

**Surfaces are named by role.** `--surface-1` and `--surface-2` are gone, with
no alias. A number says how high a surface sits, which is only meaningful if
height is what separates surfaces, and in light mode it is not.

| Token | Role |
| --- | --- |
| `--surface-canvas` | The application background. Headings only, never body text |
| `--surface-content` | The default surface for anything with text |
| `--surface-content-alt` | A content surface nested in another one |
| `--surface-input` | Text fields, text areas, selects |
| `--surface-well` | Decorative, and never carries text |
| `--surface-float` | Dropdowns, tooltips, menus |
| `--surface-disabled` | A control that cannot be used |
| `--surface-anchor` | The status bar |

`--surface-content` also carries the guarantee that ADR 0006 introduced under
that name: it is always fully opaque. The two meanings agree, because a surface
that holds text has to be opaque anyway.

**The two modes separate surfaces differently, and this is written down.** In
light mode content surfaces are white or near white and separate by border and
shadow; only the canvas-to-content boundary uses lightness. In dark mode every
adjacent pair steps by at least 0.050 L, and shadow does not count as
separation at all. In both modes the input surface moves away from the text
colour: up to white in light, down toward black in dark.

Pure white is now used deliberately, for `--surface-content`, `--surface-input`,
and `--surface-float`. ADR 0005 forbade the extremes, and that rule was really
protecting the canvas: a white canvas leaves nowhere for content to sit. A white
card on a grey canvas has the same property the old rule wanted.

Because content surfaces are white, grey is free to mean disabled, which is what
a reader already expects it to mean. A disabled control is now obviously
different from an enabled one, which it was not before.

**The check no longer takes a list of expected pairings.** It discovers every
foreground and every surface declared in `tokens.css` and measures the entire
matrix. A pair that fails must be listed in `EXEMPT` with one of two reasons:
the pairing does not occur in the interface, or WCAG 1.4.3 exempts it because
it is the label of a disabled control. There is exactly one entry of the second
kind. A short `NON_EXEMPTIBLE` list may never be waived whatever `EXEMPT` says,
and placeholder text on an input is its first entry.

Adjacency is declared in `tokens.css` and parsed, rather than inferred:

```
@separation surface-content > surface-input: border(--input-border)
@separation surface-content-alt > surface-float: shadow(--shadow-md)
```

The mechanism names the light-mode mechanism and the token that carries it. Dark
mode ignores it and requires the lightness step.

## Consequences

Positive:

- Text sits on white in light mode, which is the single biggest readability
  change and the reason this work was done.
- A disabled control is visibly disabled, because grey now means one thing.
- The check measures pairings nobody thought of, which is the class of bug that
  produced the unreadable placeholder. Adding a token forces a decision about
  where it may be used rather than silently adding an unmeasured one.
- Role names survive a change of mechanism. `--surface-content` means the same
  thing in both modes, while `--surface-2` meant a height that only one mode
  had.
- Rewriting the check found two bugs immediately: its own declaration parser was
  reading token names out of comment prose, and body text on the accent had
  never been measured, at 1.38:1 in dark mode.

Negative:

- Every component had to be rewritten, and any patch written against the old
  token names conflicts.
- Light mode now depends on borders and shadows being present. A card that
  forgets its border is invisible against the card behind it, and the check
  verifies the token, not that a component actually applied it.
- The exemption list is long, because declaring a pairing unused is how a
  token's scope is enforced. It reads as bureaucratic until a token is added
  and the list is what forces the question.
- Two mental models instead of one. A contributor has to know which mode they
  are reasoning about before they can say whether a change is correct.

Neutral:

- The translucent variant stays dark mode only, which ADR 0006 concluded from
  the elevation side after measuring the light-mode chrome compositing below
  the content it sat on. The surface model reaches the same conclusion by a
  different route and more sharply: light mode's content surfaces are now pure
  white, so there is no headroom above them at all, and any alpha composites
  them downward toward whatever the wallpaper is. The alphas in that variant are
  all at or above 0.90 so that the declared dark steps survive compositing.
- The accent, its hover, and its foreground are unchanged. They were never the
  problem.
