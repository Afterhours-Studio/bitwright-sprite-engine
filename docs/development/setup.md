# Development setup

Getting a working build of all three parts, and the commands to run each one.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 20 or later | Frontend and tooling |
| Python | 3.11 or later | The engine |
| Rust | Stable | The Tauri shell |
| Git | Any recent | Source control |

### Platform packages

**Windows**

Install the [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
with the Desktop development with C++ workload. WebView2 ships with Windows 11
and current Windows 10.

**macOS**

```bash
xcode-select --install
```

**Linux (Debian and Ubuntu)**

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

**Linux (Fedora)**

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "c-development"
```

## Automatic setup

```bash
git clone https://github.com/Afterhours-Studio/bitwright-sprite-engine.git
cd bitwright-sprite-engine

# Linux and macOS
./scripts/setup-dev.sh

# Windows (PowerShell)
./scripts/setup-dev.ps1
```

The script checks the prerequisites, installs both dependency sets, builds the
sidecar binary, and runs the checks. Pass `--gpu` (or `-Gpu` on Windows) to also
install the local generation extras, which are several gigabytes.

## Manual setup

### Frontend

```bash
npm install
```

This is an npm workspace, so one install at the root covers `apps/desktop` and
the tooling that `scripts/` needs.

### Engine

```bash
cd packages/engine
python -m venv .venv

source .venv/bin/activate        # Linux and macOS
.venv\Scripts\Activate.ps1       # Windows

pip install -e ".[dev]"
```

Torch and diffusers are optional extras, so that work on the API does not
require a multi-gigabyte download. Add one when you need local generation:

```bash
pip install -e ".[dev,cuda]"   # NVIDIA
pip install -e ".[dev,mps]"    # Apple Silicon
```

### Sidecar binary

Tauri bundles the engine as an external binary, and its configuration names one
per target triple. The crate will not build until it exists.

```bash
python scripts/build-sidecar.py
```

This freezes the engine with PyInstaller into
`apps/desktop/src-tauri/binaries/bitwright-sidecar-<triple>/`, in onedir mode.
Re-run it after changing engine code that you want the packaged application to
pick up; the development commands below run the engine from source instead.

Onedir rather than onefile because onefile unpacks its whole payload on every
launch, which will be minutes once PyTorch is in the bundle. See
[decision 0007](../architecture/decisions/0007-sidecar-packaging-strategy.md).

## Running

### The whole application

```bash
npm run tauri dev --workspace @bitwright/desktop
```

This starts the Vite dev server, builds the shell, opens the window, and spawns
the sidecar. Frontend changes hot reload. Rust changes rebuild and restart.

### The frontend alone

```bash
npm run dev
```

Serves at `http://localhost:1420`. Outside a Tauri window the shell bridge
reports that it is absent, so the interface renders with the sidecar offline.
That is the path to develop empty and error states against.

### The engine alone

```bash
cd packages/engine
.venv/bin/bitwright-engine          # Linux and macOS
.venv\Scripts\bitwright-engine.exe  # Windows
```

It prints a handshake naming the port it bound and the token that
authenticates callers:

```json
{"event": "ready", "port": 51234, "token": "3Qq7...", "version": "0.0.2"}
```

Health needs no token; everything else does:

```bash
curl http://127.0.0.1:51234/health
curl -H "X-Bitwright-Token: 3Qq7..." http://127.0.0.1:51234/v1/backends
```

A request carrying an `Origin` header is refused with 403 whatever the token,
because the only legitimate caller is the shell rather than a browser.

Pin the port to get the interactive documentation at a known address:

```bash
BITWRIGHT_PORT=8000 bitwright-engine
# http://127.0.0.1:8000/docs
```

## Checks

Run all three before opening a pull request. CI runs the same commands.

```bash
# Frontend
npm run lint
npm run typecheck
npm run test
npm run format:check

# Colour tokens
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

## Building a release

```bash
python scripts/build-sidecar.py
npm run tauri build --workspace @bitwright/desktop
```

Installers land in `apps/desktop/src-tauri/target/release/bundle/`.

## Troubleshooting

**`no sidecar found at binaries/bitwright-sidecar-<triple>/...`**

The sidecar has not been built. Run `python scripts/build-sidecar.py`.

**`error: linker 'cc' not found` on Linux**

The platform packages above are missing. Install `build-essential`.

**The window opens but stays blank**

The dev server is not running, or is on the wrong port. It is fixed at 1420,
because that port is named in the Tauri configuration and in the sidecar's
allowed origins.

**`The engine could not be started`**

The bundled binary is missing or not executable. Rebuild it, and on Linux and
macOS check the executable bit.

**Slow Rust builds**

The first build compiles the whole dependency tree and takes several minutes.
Later builds are incremental. `sccache` helps if you switch branches often.
