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

<#
.SYNOPSIS
    Prepares a development environment on Windows.

.DESCRIPTION
    Checks the prerequisites, installs the JavaScript and Python dependencies,
    builds the Python sidecar binary, and runs the checks. Linux and macOS have
    setup-dev.sh.

.PARAMETER Gpu
    Also install the CUDA extras. They are several gigabytes, so they are opt in.

.EXAMPLE
    ./scripts/setup-dev.ps1
    ./scripts/setup-dev.ps1 -Gpu
#>

[CmdletBinding()]
param(
    [switch]$Gpu
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root 'packages/engine'
$venv = Join-Path $engine '.venv'
$venvPython = Join-Path $venv 'Scripts/python.exe'

function Write-Step {
    param([string]$Message)
    Write-Information "`n==> $Message" -InformationAction Continue
}

function Assert-Command {
    param([string]$Name, [string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required but was not found. $Hint"
    }
}

Write-Step 'Checking prerequisites'
Assert-Command 'node' 'Install Node.js 20 or later from https://nodejs.org'
Assert-Command 'npm' 'Install Node.js 20 or later from https://nodejs.org'
Assert-Command 'cargo' 'Install Rust from https://rustup.rs'
Assert-Command 'python' 'Install Python 3.11 or later from https://python.org'

$nodeMajor = [int]((node --version) -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt 20) {
    throw "Node.js 20 or later is required, found $(node --version)"
}

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if (-not $?) {
    throw 'Python 3.11 or later is required'
}

Write-Step 'Installing JavaScript dependencies'
Push-Location $root
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}
finally {
    Pop-Location
}

Write-Step 'Creating the Python virtual environment'
if (-not (Test-Path $venv)) {
    python -m venv $venv
}
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -e "$engine[dev]"

if ($Gpu) {
    Write-Step 'Installing the CUDA extras'
    & $venvPython -m pip install -e "$engine[cuda]"
}

Write-Step 'Building the Python sidecar binary'
$env:PATH = (Join-Path $venv 'Scripts') + [IO.Path]::PathSeparator + $env:PATH
& $venvPython (Join-Path $root 'scripts/build-sidecar.py')
if ($LASTEXITCODE -ne 0) { throw 'the sidecar build failed' }

Write-Step 'Verifying the setup'
Push-Location $root
try {
    npm run check:contrast
    if ($LASTEXITCODE -ne 0) { throw 'the contrast check failed' }
}
finally {
    Pop-Location
}
& $venvPython -m pytest $engine -q
if ($LASTEXITCODE -ne 0) { throw 'the engine tests failed' }

Write-Information @'

Setup complete.

  Run the app:        npm run tauri dev --workspace @bitwright/desktop
  Run the sidecar:    packages\engine\.venv\Scripts\bitwright-engine.exe
  Frontend checks:    npm run lint; npm run typecheck; npm run test
  Engine checks:      cd packages\engine; ruff check .; mypy .; pytest
  Shell checks:       cd apps\desktop\src-tauri; cargo clippy --all-targets

'@ -InformationAction Continue
