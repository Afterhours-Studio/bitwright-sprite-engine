# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versions are `major.minor.develop`:

| Part | Meaning |
| --- | --- |
| major | Breaking change. Stays at 0 until the first stable release |
| minor | A user-facing capability is complete |
| develop | A development pass within the current minor |

Both leading zeros are accurate today. Nothing has been released, and no
user-facing capability is finished: the backends return placeholder images and
model downloading is not implemented.

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

[0.0.2]: https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases/tag/v0.0.2
[0.0.1]: https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases/tag/v0.0.1
