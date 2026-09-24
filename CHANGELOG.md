# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/). Versions
before 0.2.0 belong to the diffusion-based sprite generator this application
used to be; they are kept below as history.

## [1.0.0] - 2026-09-24

The first release to rely on: every feature the plan describes, documented,
tested, and checked by the full gate.

### Removed

- **Breaking:** the sprite gallery, the engine's `/v1/sprites` routes, the
  shell commands behind them and the `sprites` folder setting. They showed a
  folder only the removed generator wrote to; a sprite is a document opened
  from the project tree.

### Changed

- The title bar's folder item opens the exports folder, where exports made by
  an agent through MCP land.
- The README and the guides describe the application as it is: installation,
  configuration (the data root, the MCP transports and token, connecting a
  client, where exports go), running and testing. The tool catalogue lists
  every tool, `read_guide` included.

### Added

- Tests for every store action, the document and shell bridges on the wire,
  the store's remaining methods, export rendering, the external-link and
  folder guards, the MCP client descriptions and status, the engine's reading
  of an answer, and an allowed shutdown of the engine.

## [0.2.0] - 2026-09-24

Bitwright is now an agent-driven pixel art editor: a person and an AI agent
draw on the same indexed canvas, the agent through MCP, and the engine's
gates judge each step of the drawing workflow from the pixels themselves.

### Added

- **The indexed document.** Projects, styles and assets in one SQLite file;
  every edit an entry in an op log with undo and redo; layers as the
  workflow's steps; palettes as ramps of slots checked against the style's
  rules (ramp length, hue shift, value floor and ceiling).
- **The editor.** The canvas with zoom, pan, the pixel grid and the paint
  tools; the palette editor; the layer list; the step rail with every step,
  revisiting a done step and forcing an advance past a failed gate, both
  behind a confirmation.
- **MCP.** A server over streamable HTTP on loopback with a token, and over
  stdio (`--mcp-stdio`), with tools to read the canvas as text, write pixels,
  shade, outline, set palettes, move through the workflow and undo; client
  configuration for Claude Code, Claude Desktop and Cursor; live sync with an
  agent-activity indicator; the drawing manual served by the server itself
  (`read_guide`, `bitwright://guide/*`).
- **References.** Import a picture with the system file dialog, conformed to
  the sprite's size by the sidecar; inspect its detected grid, palette and
  warnings; apply its colours as the palette. `read_reference` and
  `extract_palette` give an agent the same.
- **Tilemaps.** A background is a grid of tile assets in up to eight parallax
  layers, edited in the tilemap editor or by an agent with `create_tilemap`,
  `read_tilemap`, `place_tiles` and `tilemap_layers`.
- **Export.** A sprite, a sheet of sprites, or a background to PNG at a scale,
  into a folder the person picks, named from a pattern and never escaping it;
  `export_png` and `export_sheet` let an agent export into the exports folder.
- English and Vietnamese throughout.

### Removed

- Image generation: the diffusion backends, models, runtimes and providers,
  the generation screen and its settings, and the gallery of generated
  sprites. See ADR-0012.

## [0.1.1] - 2026-09-06

### Added

- A Binaries report in the dock, naming what this machine can run and what is
  missing from it. Every fact in it already existed in a store and none of it
  was on screen, so an application with a working GPU in front of it reported
  nothing at all, and the missing piece could only be found in a log.
- The GPU runtime can be installed from Settings, into the data folder already
  chosen for weights.

### Changed

- Size presets are a dropdown. The pills spent a row of a narrow column on four
  values, and a size that was not one of them showed nothing selected, which
  reads as broken rather than as custom.

### Fixed

- Downloads survive a restart. The partial file was deleted on every exit from
  the worker, and the sidecar being torn down surfaces as a dropped connection,
  so the one case resume exists for was the one that discarded the bytes.
- Model URLs point at files that exist; all four answered 404.
- The icon rail is square, the rails match the radius of the card above them,
  and a tooltip near the window edge is nudged back inside instead of clipped.

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
