#!/usr/bin/env bash
# Bitwright - Sprite Engine
# Copyright (C) 2026 Afterhours Studio
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.
#
# Prepares a development environment on Linux and macOS. Windows has
# setup-dev.ps1.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$ROOT/packages/engine"
VENV="$ENGINE/.venv"

info() { printf '\n==> %s\n' "$1"; }
fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found. $2"
}

info "Checking prerequisites"
require node "Install Node.js 20 or later from https://nodejs.org"
require npm "Install Node.js 20 or later from https://nodejs.org"
require cargo "Install Rust from https://rustup.rs"
require python3 "Install Python 3.11 or later from https://python.org"

node_major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
[ "$node_major" -ge 20 ] || fail "Node.js 20 or later is required, found $(node --version)"

python3 - <<'PY' || fail "Python 3.11 or later is required"
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY

info "Installing JavaScript dependencies"
(cd "$ROOT" && npm install)

info "Creating the Python virtual environment"
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -e "$ENGINE[dev]"

# The GPU extras are several gigabytes, so they are opt in. Pass --gpu to
# install the one that matches this machine.
if [ "${1:-}" = "--gpu" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    info "Installing the Apple Silicon extras"
    "$VENV/bin/python" -m pip install -e "$ENGINE[mps]"
  else
    info "Installing the CUDA extras"
    "$VENV/bin/python" -m pip install -e "$ENGINE[cuda]"
  fi
fi

info "Building the Python sidecar binary"
PATH="$VENV/bin:$PATH" "$VENV/bin/python" "$ROOT/scripts/build-sidecar.py"

info "Verifying the setup"
(cd "$ROOT" && npm run check:contrast)
"$VENV/bin/python" -m pytest "$ENGINE" -q

cat <<'DONE'

Setup complete.

  Run the app:        npm run tauri dev --workspace @bitwright/desktop
  Run the sidecar:    packages/engine/.venv/bin/bitwright-engine
  Frontend checks:    npm run lint && npm run typecheck && npm run test
  Engine checks:      cd packages/engine && ruff check . && mypy . && pytest
  Shell checks:       cd apps/desktop/src-tauri && cargo clippy --all-targets

DONE
