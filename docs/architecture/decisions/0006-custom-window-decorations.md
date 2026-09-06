# 6. Draw our own window decorations

Date: 2026-02-04

## Status

Accepted

## Context

Bitwright's title bar carries the application name and the window buttons, and
sits on the same surface as the sidebar. With the system title bar on, the
window has two bars: the platform's, in the platform's colours, and ours below
it. That looks like a mistake, and on Windows it looks like a mistake in the
platform's light theme while the application is in dark.

Turning the system decorations off is what most applications of this shape do.
It also means taking on everything the platform was doing: dragging, double
click to maximize, the buttons themselves, resize edges, and the platform
conventions for where the buttons go.

The three platforms disagree on that last point in a way that cannot be
abstracted:

**macOS** keeps drawing its traffic lights over the client area even with
decorations off, at the top left. Drawing our own would produce two sets. The
correct behaviour is to draw none and leave a gap for the system's.

**Windows** draws nothing. Minimize, maximize, and close have to be drawn, on
the right, in that order, and the close button turns the system red on hover.

**Linux** also draws nothing, and button placement varies by desktop
environment. The right is the common default.

A second question came with it. Custom decorations are usually paired with a
platform background effect: Mica on Windows 11, vibrancy on macOS. Those need a
transparent window, and a transparent window with opaque CSS surfaces hides the
effect completely. So a second, translucent token set is needed.

That introduces a failure mode worth naming. If the frontend assumes the effect
applied and the effect did not, the canvas is transparent over nothing, and text
sits on the user's wallpaper at whatever contrast the wallpaper happens to give.
The effect can fail for reasons the frontend cannot see: Windows 10 has no Mica,
a Linux compositor has no equivalent, and the call can simply fail.

## Decision

System decorations are off, and Bitwright draws its own title bar.

```json
{
  "decorations": false,
  "transparent": true,
  "titleBarStyle": "Overlay",
  "hiddenTitle": true,
  "shadow": true
}
```

Platform handling:

- The shell reports `systemWindowControls`, which is true only on macOS. The
  frontend draws its own buttons when it is false.
- The frontend sets `data-platform` on the root element, and
  `--titlebar-inset-start` becomes 78px on macOS to clear the traffic lights.
- The drag region is marked with `data-tauri-drag-region`, and double clicking
  it maximizes, which is what every platform's own title bar does.

Background effects, applied in `main.rs` under `cfg` per target:

| Platform | Effect | Notes |
| --- | --- | --- |
| macOS | `NSVisualEffectMaterial::UnderWindowBackground` | Tints from the desktop behind the window |
| Windows 11 | Mica | Falls through to the next row when unavailable |
| Windows 10 | Acrylic, opt in | Repaints the whole window during a drag, so it stutters. Off unless `BITWRIGHT_VIBRANCY=acrylic` |
| Linux | None | No compositor-independent way to blur behind a window |

Applying an effect never panics. The result is recorded and returned by the
`vibrancy_state` command.

**The frontend never guesses whether an effect applied.** It reads the command
and sets `data-vibrancy` to `on` or `off`, which selects the translucent or the
opaque token set. Opaque is the default and the safe one: an active effect
behind opaque surfaces merely looks flat, while transparent surfaces with no
effect leave text over a wallpaper.

Three rules constrain where translucency is allowed:

1. **Text is never placed directly on a vibrancy surface.** The image behind it
   is the user's wallpaper, so no contrast guarantee can be made. Text sits on a
   surface with alpha of at least 0.85, or a fully opaque one.
2. **Only chrome is translucent.** The title bar, the sidebar, and the outermost
   background. The content area uses `--surface-content` and stays opaque.
3. **Only dark mode is translucent.** Found by running the application rather
   than by reading the tokens: a translucent light-mode chrome composites toward
   the user's wallpaper, and light mode sits so close to the L 1.0 ceiling that
   a dark wallpaper drags the chrome below the content and inverts the elevation
   order. Measured at sRGB 209 for the sidebar against 225 for the content, when
   the sidebar is supposed to be the higher layer. No alpha value fixes it. Dark
   mode has the whole range below its chrome and blends safely.

## Consequences

Positive:

- One title bar, in the application's own colours, following the theme.
- The window reads as native on Windows 11 and macOS, where the effect is
  available.
- Each platform's button convention is followed rather than averaged.
- Fallback is automatic and correct. Linux and Windows 10 get an opaque window
  that looks deliberate, not broken.
- The transparency decision is made where the facts are, in Rust.

Negative:

- Dragging, double click to maximize, and the buttons are ours to maintain, and
  each can break on one platform only.
- A platform we do not test can place its buttons somewhere unexpected. Linux
  desktop environments vary, and the right-hand default will be wrong on some.
- Two token sets to keep in step. A colour added to one and not the other shows
  up only with the effect active.
- Light mode gets no background effect at all, on any platform. A Windows 11
  user in light mode sees an opaque window where a dark mode user sees Mica.
  That is an inconsistency someone will report as a bug, and the reasoning has
  to be repeated each time.
- `transparent: true` is required for the effect and costs a little compositing
  performance even when no effect is applied.
- Accessibility settings that reduce transparency are respected by the platform
  effect but not reflected back to us, so the translucent tokens stay selected.

Neutral:

- The macOS inset is a token, not a hardcoded padding, so a future platform
  needing its own inset is one line.
- Acrylic on Windows 10 is deliberately opt in rather than removed. A user who
  wants it can set the environment variable and accept the stutter.
