# Bitwright - Sprite Engine

Agent-driven pixel art editor for games.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://github.com/Afterhours-Studio/bitwright-sprite-engine/blob/main/LICENSE)
[![CI](https://github.com/Afterhours-Studio/bitwright-sprite-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Afterhours-Studio/bitwright-sprite-engine/actions/workflows/ci.yml)
[![License check](https://github.com/Afterhours-Studio/bitwright-sprite-engine/actions/workflows/license-check.yml/badge.svg)](https://github.com/Afterhours-Studio/bitwright-sprite-engine/actions/workflows/license-check.yml)
[![Release](https://img.shields.io/github/v/release/Afterhours-Studio/bitwright-sprite-engine?include_prereleases&sort=semver)](https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/Afterhours-Studio/bitwright-sprite-engine/blob/main/docs/getting-started/system-requirements.md)

Bitwright is a desktop pixel art editor whose canvas an MCP client — an AI agent
— drives. The document is indexed: every pixel is a palette slot, so a layer
reads back as text and an agent can see exactly what it drew. Layers are the
workflow steps of a sprite — silhouette, flats, shadow-core, shadow-deep, light,
outline, detail, rim, accent — and each step has a gate measured from the pixels
rather than asserted by the agent. The engine chooses the shading colours; the
agent places them.

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Development](#development)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Features

- An MCP client drives the canvas, and you watch it draw. The editor shows
  "Agent drawing · <tool>" while a tool call is in flight, and an `open_asset`
  call switches the window to the asset the agent is working on.
- Indexed document: pixels are palette slots, so a 64 by 64 layer reads back as
  sixty-four lines of sixty-four characters with rulers, and an agent can count
  to the pixel it means.
- Layers are the workflow steps. Each step writes its own layer, so revising the
  shading does not destroy the detail pass.
- Gates are computed from the pixel buffer. A silhouette that is two
  disconnected regions does not pass, whatever the agent says about it.
- The engine chooses shading colours; the agent places them. No tool accepts a
  hex value for shading.
- The MCP server runs inside the application, with two transports: **HTTP
  Local**, a loopback endpoint with a bearer token, and **stdio**, for clients
  that spawn the process themselves.
- Settings → **Agent connection** card: transport, status, URL with copy, token
  (masked, with Reveal, Copy and Regenerate), connected sessions, one row per
  client (Claude Code, Claude Desktop, Cursor) with Register and Remove,
  **Configure all detected clients**, and **Manual configuration** — a JSON
  snippet for any other client.
- Client configuration is written for Claude Code (`~/.claude.json`), Cursor
  (`~/.cursor/mcp.json`) and Claude Desktop (`claude_desktop_config.json`,
  stdio). Only the `mcpServers.bitwright` key is written, a `.bak` is kept, and
  invalid JSON is never overwritten.
- You can draw too. The tool panel has pencil, fill, line and shape tools, and
  your strokes and the agent's tool calls end in the same buffer and the same
  undo history.
- Windows, macOS, and Linux, from one codebase.
- English and Vietnamese, with a translation system that fails the build when a
  key is missing from either.
- Dark and light themes, with contrast and elevation verified in CI rather than
  by eye.
- No telemetry. The MCP server never reaches the network, never runs commands,
  and reads or writes no files but the document store.
- The HTTP transport is authenticated and loopback only, so no other process on
  the machine can drive it, and a web page cannot reach it through DNS
  rebinding. Requests carrying an `Origin` header are refused with 403, and a
  wrong or missing token is 401.

Thirty tools are registered today, listed in
[the MCP tool catalogue](docs/architecture/mcp-tools.md). Four are not:
`read_reference` and `extract_palette` arrive with reference import in Phase 3,
and `export_png` and `export_sheet` arrive with export in Phase 4. A tool whose
machinery does not exist yet is absent from `tools/list` rather than answered
with a placeholder.

## Installation

Download from the [releases page](https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases).
Full instructions, including what to do when the operating system blocks the
first launch, are in [the installation guide](docs/getting-started/installation.md).

<details>
<summary><b>Windows</b></summary>

Download and run `Bitwright_<version>_x64-setup.exe`.

SmartScreen may warn that the publisher is unrecognised, because pre-1.0 builds
are not code signed. Choose **More info**, then **Run anyway**.

The WebView2 runtime is required and installs automatically if missing. It ships
with Windows 11 and current Windows 10.

</details>

<details>
<summary><b>macOS</b></summary>

Download `Bitwright_<version>_universal.dmg`, open it, and drag Bitwright to
Applications.

The first launch is blocked, because pre-1.0 builds are not notarised. Open
**System Settings**, then **Privacy & Security**, and choose **Open Anyway**.

</details>

<details>
<summary><b>Linux</b></summary>

```bash
# AppImage
chmod +x Bitwright_0.0.3_amd64.AppImage
./Bitwright_0.0.3_amd64.AppImage

# Debian and Ubuntu
sudo apt install ./bitwright_0.0.3_amd64.deb

# Fedora
sudo dnf install ./bitwright-0.0.3-1.x86_64.rpm
```

If the window does not open, install the WebKit runtime:

```bash
sudo apt install libwebkit2gtk-4.1-0   # Debian and Ubuntu
sudo dnf install webkit2gtk4.1         # Fedora
```

</details>

## Quick start

1. Open **Settings**, then **Agent connection**. Leave the transport at **HTTP
   Local**: it binds a loopback port and issues a token, so the client has to be
   on this machine.
2. Press **Configure all detected clients**. Bitwright looks for Claude Code,
   Claude Desktop and Cursor, writes the server entry into each one's
   configuration, and lists what it found. Each client has its own row with
   **Register** and **Remove**. If your client is not one of the three, **Manual
   configuration** on the same card is the JSON snippet to paste in yourself.
3. Restart the client so it picks up the new server. The connected sessions list
   on the card turns over when it connects. A client that spawns the process
   itself uses stdio instead — `bitwright --mcp-stdio` — and carries no token,
   because the spawning process is the trust boundary.
4. In your client, ask the agent to open an asset and draw it:

   ```
   Open the "knight" asset in my "Verdance" project in Bitwright and draw it:
   a knight in plate armour, side view, idle.
   ```

The agent works through the ordered steps, and each step writes its own layer.
Watch the canvas while this happens: a tool call reaches the window as a direct
event, so the sprite appears as it is drawn rather than arriving finished.

Saving is implicit. The document is a row in a SQLite file under your data root,
and there is no save button because there is nothing to save. Export is the
explicit action, and it is Phase 4.

More in [the quick start guide](docs/getting-started/quick-start.md).

## Configuration

Most settings are in the application. The data root can also be set with an
environment variable.

| Setting   | Variable              | Default                 | Meaning                                      |
| --------- | --------------------- | ----------------------- | -------------------------------------------- |
| Data root | `BITWRIGHT_DATA_ROOT` | platform local app-data | Where `bitwright.db` and `mcp.json` are kept |
| Log level | `BITWRIGHT_LOG_LEVEL` | `INFO`                  | Sidecar log level                            |

The data root holds `bitwright.db` — projects, assets and the op log — and
`mcp.json`, which records the transport, the port and the token. The port is
kept between runs when it is free.

Full list in [the configuration reference](docs/reference/configuration.md).

## Development

Requires Node.js 20 or later, Python 3.11 or later, and a stable Rust
toolchain. Platform packages are listed in
[the setup guide](docs/development/setup.md).

```bash
git clone https://github.com/Afterhours-Studio/bitwright-sprite-engine.git
cd bitwright-sprite-engine

# Linux and macOS
./scripts/setup-dev.sh

# Windows (PowerShell)
./scripts/setup-dev.ps1

npm run tauri dev --workspace @bitwright/desktop
```

The setup script checks the prerequisites, installs both dependency sets, builds
the Python sidecar binary, and runs the checks.

<details>
<summary><b>Running the checks</b></summary>

```bash
# Frontend
npm run lint
npm run typecheck
npm run test
npm run format:check

# Colour tokens: elevation steps and contrast ratios
npm run check:contrast

# Engine
cd packages/engine
ruff format --check .
ruff check .
mypy .
pytest

# Shell
cd apps/desktop/src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test

# Dependency licences
python scripts/check-licenses.py
```

CI runs all of these on Linux, Windows, and macOS.

</details>

<details>
<summary><b>Building a release</b></summary>

```bash
python scripts/build-sidecar.py
npm run tauri build --workspace @bitwright/desktop
```

Installers land in `apps/desktop/src-tauri/target/release/bundle/`.

</details>

<details>
<summary><b>Repository layout</b></summary>

```
apps/desktop/            React frontend and the Tauri shell
  src/                   Components, features, stores, hooks, locales
  src-tauri/             Rust: window, store, raster core, MCP server
packages/engine/         Python sidecar, kept for conform (reference import)
  bitwright_engine/
    api/                 FastAPI application, routes, schemas
docs/                    Guides, architecture, decision records
scripts/                 Setup, sidecar build, contrast and licence checks
```

</details>

## Architecture

The application is two processes — the Rust shell and the Python sidecar — and
the agent is a client of the shell:

```
React (webview)   --Tauri IPC-->   Rust shell   --loopback HTTP-->   Python sidecar
                                     |   (store, raster core,          (conform only,
                                     |    MCP server)                   reference import)
                        loopback HTTP / stdio
                                     |
                              MCP client (agent)
```

The Rust shell owns the window, the document store, the raster core and the MCP
server. The frontend talks to Rust over Tauri IPC for the document and the
window. The MCP server exposes the tool catalogue over loopback HTTP at
`http://127.0.0.1:<port>/mcp` with a bearer token, or over stdio when a client
spawns the process with `bitwright --mcp-stdio`; the spawning process is the
trust boundary there, so stdio carries no token.

The shell spawns the Python sidecar at startup. The sidecar serves conform —
reference import — only, over its own authenticated loopback API; every other
tool is answered by the Rust shell itself.

Details in [the architecture overview](docs/architecture/overview.md), the tool
catalogue in [the MCP tools](docs/architecture/mcp-tools.md), and the reasoning
in [the decision records](docs/architecture/decisions/0001-record-architecture-decisions.md).

## Roadmap

- [x] Phase 0 — Demolition and foundations: the diffusion generator deleted,
      the pivot recorded
- [x] Phase 1 — Document model and canvas: the SQLite store, the raster core,
      IPC, the project tree, the canvas and the paint tools
- [x] Phase 2 — MCP: the server, both transports, the tools, client
      configuration, live sync
- [ ] Phase 3 — Workflow and skills: the step rail and gate results in the
      interface, the HD-2D skill pack and its installer, reference import
- [ ] Phase 4 — Assets, export, polish: tile and tilemap backgrounds, PNG and
      sheet export, the i18n sweep, these documents and their screenshots

The phases, and what each one contains, are in [the plan](docs/plan/PLAN.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it
covers the workflow, the commit convention, the coding standards, and the rule
that a new string must exist in both locales.

Contributors sign a CLA that assigns copyright in the contribution to Afterhours
Studio. The reasoning is set out in
[CONTRIBUTING.md](CONTRIBUTING.md#contributor-license-agreement) and in
[decision 0004](docs/architecture/decisions/0004-agpl-license-choice.md).

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md). Security
issues go through [SECURITY.md](SECURITY.md), never a public issue.

## License

Licensed under the GNU Affero General Public License v3.0 only.

Copyright (C) 2026 Afterhours Studio. See [LICENSE](LICENSE) for the full text
and [NOTICE](NOTICE) for the notice.

Third party dependencies and their licences are listed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), and checked in CI.

---

Built by [h1dr0n](https://github.com/h1dr0nn) at
[Afterhours Studio](https://github.com/Afterhours-Studio).
