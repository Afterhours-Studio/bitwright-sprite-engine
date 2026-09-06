# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versions are `major.minor.develop`:

| Part    | Meaning                                                    |
| ------- | ---------------------------------------------------------- |
| major   | Breaking change. Stays at 0 until the first stable release |
| minor   | A user-facing capability is complete                       |
| develop | A development pass within the current minor                |

The leading zero is accurate today: nothing has been released, and the
backends still return placeholder images rather than generating anything.

## [0.1.0] - 2026-09-06

The minor moves because two user-facing capabilities are finished rather than
sketched: model weights genuinely download, and a remote provider can be
configured and used. Generation itself is still a placeholder, which is why the
major stays at zero.

### Added

- Remote API providers. Several can be configured, one is active, and a
  connection test reports what the endpoint actually said. Presets for four
  OpenAI-compatible hosts, plus a custom endpoint for an aggregator or router.
  API keys live in the operating system credential store, and never reach the
  interface: it receives a presence flag and a masked hint.
- A configurable storage location, so model weights can live off a full system
  drive. Writability is proven by writing, and a change is refused while a
  download is running.
- Real model downloading: streamed, resumable to the extent of discarding a
  partial cleanly, cancellable, with progress.
- A notification system. Errors that were previously swallowed now surface, and
  are kept in a history reachable from the dock.
- A command palette, reached with Ctrl+K, that finds Vietnamese entries typed
  without diacritics.
- A dock carrying the drawing tools, and a system theme that follows the
  operating system's own light and dark schedule.

### Changed

- The dark palette sits 0.080 OKLCH lightness higher throughout. The previous
  values rendered the application almost black: OKLCH lightness is close to the
  cube root of luminance down there, so numbers that read as reasonable came out
  at sRGB 18.
- Number fields draw their own stepper, and integer fields refuse a decimal
  point rather than rounding one away later.

### Fixed

- The frozen sidecar shipped without Pillow and started only to exit, because
  the freezer ran under whichever interpreter was on PATH. It now builds from
  the engine's own environment, and the build fails if the artefact cannot
  start.
- A debug build runs the engine from source instead of the frozen bundle, so a
  Python change no longer needs a freeze before it can be seen.
- Scrollbar styling had never applied on Windows: declaring `scrollbar-width`
  makes Chromium drop the whole `::-webkit-scrollbar` cascade.

## [0.0.3] - 2026-02-12

A rebuild of the surface system, after the previous one turned out to be sound
in its reasoning and wrong in its result: every light-mode surface was grey, so
every piece of text in the application sat on grey.

### Added

- A role-based surface model: `--surface-canvas`, `--surface-content`,
  `--surface-content-alt`, `--surface-input`, `--surface-well`,
  `--surface-float`, `--surface-disabled`, `--surface-anchor`. Roles hold in
  both modes; heights did not.
- `--fg-placeholder`, `--fg-on-anchor`, `--input-border`, and
  `--input-border-focus`.
- `@separation` declarations in `tokens.css`, naming each adjacent pair, the
  mechanism that separates them in light mode, and the token that carries it.
  The check parses these rather than guessing.
- Styled scrollbars. The platform scrollbar ignores the theme and is the first
  thing that gives away a web view.
- [ADR 0009](docs/architecture/decisions/0009-asymmetric-surface-model.md), which
  supersedes ADR 0005.

### Changed

- **Light and dark now separate surfaces by different mechanisms.** In light
  mode the canvas is grey, content surfaces are white, and they are separated by
  border and shadow; only the canvas-to-content boundary uses lightness. In dark
  mode content surfaces step by at least 0.050 L and shadow is not a separation
  mechanism at all. This is what GitHub Primer, Atlassian, and Material 3 do,
  and the reason is physical: a shadow reads on a light ground and vanishes on a
  dark one.
- Pure white is now used for `--surface-content`, `--surface-input`, and
  `--surface-float`. The canvas is still never white or black, which is what the
  old rule was really protecting.
- Grey now means disabled, and only disabled. A disabled control is finally
  distinguishable from an enabled one, which it was not before.
- **The contrast check no longer takes a list of expected pairings.** It
  discovers every foreground and surface from `tokens.css` and measures the
  whole matrix. A failing pair must be declared unused or exempt, so adding a
  token forces a decision instead of silently adding an unmeasured one.
- Navigation moved from a vertical rail into a horizontal pill row in the title
  bar, the status bar became a floating pill, and the window gained a bezel, to
  match the reference design.
- `--surface-1`, `--surface-2`, and `--surface-sunken` are gone, with no alias.

### Fixed

- Placeholder text was unreadable in both modes and had never been measured:
  `--fg-placeholder` did not exist in the old check's list at all. It is now
  held to a full 4.5:1 on `--surface-input` and can never be waived.
- The check's own declaration parser was reading token names out of comment
  prose. A scope note containing "4.5:1 on `--surface-input`: a placeholder is
  read" made the parser swallow the real declaration that followed, so
  `--surface-input` and `--fg-primary` looked undeclared in light mode.
- Body text on the accent had never been measured. It is 1.38:1 in dark mode,
  which is why the accent has a foreground token of its own.
- The `models/` ignore rule and the Tailwind restart trap are both now written
  down in the design system's Common mistakes, having each cost a debugging
  session.

## [0.0.2] - 2026-02-10

Hardening pass over the scaffold, with the whole application run on a real
desktop for the first time.

### Added

- Token authentication on the engine. It generates a token at startup, reports
  it in the handshake, and compares it with `secrets.compare_digest`. Loopback
  binding keeps the API off the network but not away from other processes on
  the machine, which is what the token is for.
- Rejection of any request carrying an `Origin` header, whatever the origin.
  The only legitimate caller is the shell, which is not a browser, so a request
  with one came from a web page. This closes off DNS rebinding.
- Orphan protection. The shell passes its process id, and the engine exits when
  that process is gone, so a crashed or force-killed shell cannot leave Python
  holding GPU memory that the next launch then fails to allocate. Linux
  additionally gets a kernel death signal.
- An always-opaque `--surface-content` token for the main content area.
- Two architecture decision records: 0007 on sidecar packaging, which also
  records the fallback if the bundle grows too large, and 0008 on engine
  authentication.

### Changed

- The webview no longer calls the engine directly. It goes through four shell
  commands, each a fixed method and path, so the token never enters the webview
  and a compromised page has nothing to replay. This amends ADR 0003 and is
  recorded in ADR 0008.
- The sidecar is packaged with PyInstaller in onedir mode and shipped through
  bundle resources. Onefile unpacks its whole payload on every launch, which is
  tolerable at 47 MB and would be thirty to sixty seconds once PyTorch is in
  the bundle. Recorded in ADR 0007.
- `--fg-muted` is now reserved for the label of a disabled control. The WCAG
  1.4.3 exemption that allows its 3.28:1 covers disabled controls and nothing
  else, so hints, placeholders, status lines, and the reason an engine is
  unavailable moved to `--fg-secondary` and are held to 4.5:1.
- The translucent token set applies in dark mode only. Running the application
  showed the light-mode chrome compositing at sRGB 209 against content at 225,
  below the surface it is supposed to sit on: light mode has no headroom above
  its chrome to blend toward a dark wallpaper with. Dark mode has the range.
- The status bar reports readiness from the selected backend rather than from
  the sidecar being up, so it no longer says Ready next to an engine whose
  driver is missing.

### Fixed

- The content area had no background of its own and drew straight onto the
  canvas token, which is transparent while a background effect is active. Text
  was sitting on the user's wallpaper, against the project's own rule.
- The Tauri resource glob was `binaries/*`, which matches no files in a
  directory tree and failed only at build time, never under `cargo check`.
- Pills stretched to full width outside the sidebar. A caller-supplied `w-auto`
  does not beat a base `w-full`: both have the same specificity, so Tailwind's
  own emission order decides, not the class attribute.
- The `models/` ignore rule also matched the engine's own models package, which
  would have left that source directory untracked.

## [0.0.1] - 2026-02-09

The first scaffold. Every layer in place and running end to end, with the
diffusion backends returning placeholder images.

### Added

- Desktop application: React 18, TypeScript, and Vite in a Tauri 2 shell, with
  a Python 3.11 FastAPI engine running as a sidecar process.
- Backend abstraction with `available()`, `capabilities()`, and `generate()`,
  and CUDA, Apple Silicon, and remote API implementations.
- Capability negotiation surfaced to the interface, so an option the selected
  engine cannot serve is disabled rather than failing after the user commits to
  a run.
- Sidecar lifecycle in the shell: the engine binds a free loopback port and
  reports it in a handshake, and shutdown drains in-flight work before the
  process is stopped.
- Post-processing for sprites: background removal by corner flood fill, palette
  quantization that preserves alpha, pixel grid snapping, and sheet packing with
  per-frame rectangles.
- Model registry carrying each model's licence and whether commercial use is
  permitted, shown before anything is downloaded.
- Custom window decorations with per-platform button placement, and Mica,
  macOS vibrancy, or an opaque fallback depending on what the platform supports.
- OKLCH design token system with a minimum lightness step between adjacent
  surfaces and a contrast floor for every text pairing, both enforced by
  `scripts/check-contrast.ts` in CI.
- English and Vietnamese, with a locale parity test that fails the build when a
  key exists in one language and not the other.
- Documentation, including six architecture decision records.
- CI for lint, type check, and tests across Linux, Windows, and macOS; CLA
  enforcement; and dependency licence scanning.

### Security

- The engine refuses to bind any address that is not loopback, as a raise rather
  than an assertion, so the check survives `python -O`.

[0.0.3]: https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases/tag/v0.0.3
[0.0.2]: https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases/tag/v0.0.2
[0.0.1]: https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases/tag/v0.0.1
