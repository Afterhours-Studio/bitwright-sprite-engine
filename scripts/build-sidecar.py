#!/usr/bin/env python3
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

"""Freeze the Python engine into the sidecar the application ships.

PyInstaller is run in **onedir** mode, not onefile. A onefile build unpacks its
whole payload into a temporary directory on every launch. That is tolerable for
the 24 MB stub, and unacceptable once PyTorch is in the bundle: unpacking two to
four gigabytes would put thirty to sixty seconds in front of every start, every
time. Onedir pays that cost once, at install. See
docs/architecture/decisions/0007-sidecar-packaging-strategy.md.

The output directory and its executable both carry the Rust target triple, so
that artefacts for different platforms can sit side by side without colliding,
and so a bundle can never pick up a binary built for another target:

    binaries/bitwright-sidecar-x86_64-pc-windows-msvc/
        bitwright-sidecar-x86_64-pc-windows-msvc.exe
        _internal/...

The triple is read from ``rustc -vV`` rather than guessed from the interpreter,
because it is Rust's view of the target that has to match.

Usage::

    python scripts/build-sidecar.py
    python scripts/build-sidecar.py --triple x86_64-unknown-linux-gnu
"""

from __future__ import annotations

import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "packages" / "engine"
ENTRY = ENGINE / "bitwright_engine" / "__main__.py"
OUTPUT = ROOT / "apps" / "desktop" / "src-tauri" / "binaries"
NAME = "bitwright-sidecar"

# Uvicorn resolves these by name at run time, so the freezer cannot find them by
# following imports.
HIDDEN_IMPORTS = (
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
)

# Standard library modules the freezer would otherwise leave out.
#
# PyInstaller ships only what it can see being imported. That is correct for
# every dependency in the bundle and wrong for exactly one thing: the GPU
# runtime, which is downloaded into the user's data folder after the build and
# put on the import path at startup. PyTorch imports a wide slice of the
# standard library that this engine never touches, and every one of those would
# be a module the frozen interpreter simply does not have. There is no list of
# them that can be checked, because it changes with every PyTorch release, so
# the standard library is taken whole instead of guessed at.
#
# See docs/architecture/decisions/0011-gpu-runtime-installation.md.
STDLIB_EXCLUDED = frozenset(
    {
        # Tk drags in a native toolkit and its data files, tens of megabytes for
        # a sidecar that draws nothing.
        "tkinter",
        "turtle",
        "turtledemo",
        "idlelib",
        # Test suites, demos, and the documentation database. None is imported
        # by a library at run time.
        "test",
        "lib2to3",
        "pydoc_data",
        "antigravity",
        "this",
    }
)


def stdlib_modules() -> tuple[str, ...]:
    """Return the standard library modules to force into the bundle.

    Private modules are left out: they are pulled in by the public ones that
    need them, and naming them directly is how a build ends up depending on an
    implementation detail of one interpreter version.

    Returns:
        Module names, sorted.
    """
    return tuple(
        sorted(
            name
            for name in sys.stdlib_module_names
            if not name.startswith("_") and name not in STDLIB_EXCLUDED
        )
    )


# Packages that have to be taken whole rather than by following imports.
# Pillow loads its codecs as C extensions by name, and a build has already
# shipped with an empty PIL directory and a green exit code, which is how the
# smoke test below came to exist.
#
# keyring is here for the same reason in a different disguise: it discovers its
# platform backends through entry point metadata, not through imports, so
# following imports finds the package and none of the backends that make it
# work. Without this the frozen sidecar decides no credential store exists and
# silently falls back to writing API keys into a file.
COLLECT_ALL = ("PIL", "keyring")


def host_triple() -> str:
    """Return the Rust target triple of this machine.

    Returns:
        The host triple, as ``rustc`` reports it.

    Raises:
        RuntimeError: ``rustc`` is not installed, or reported no host.
    """
    try:
        output = subprocess.run(  # noqa: S603 - fixed argument list, no shell
            ["rustc", "-vV"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError("rustc is required to determine the target triple") from error

    for line in output.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()

    raise RuntimeError("rustc did not report a host triple")


def executable_name(triple: str) -> str:
    """Return the name of the frozen executable for a target.

    Args:
        triple: The Rust target triple.

    Returns:
        The file name, with a ``.exe`` suffix on Windows.
    """
    suffix = ".exe" if platform.system() == "Windows" else ""
    return f"{NAME}-{triple}{suffix}"


def find_pyinstaller() -> str:
    """Return the PyInstaller to freeze with, preferring the engine's own venv.

    The freezer bundles whatever its *own* interpreter can import, so the
    interpreter decides what ends up shipped. Taking it from PATH means the
    artifact depends on which shell the build happened to run in: a build from
    outside the venv silently produced a bundle with no Pillow in it, and only
    the smoke test caught it. The venv holds the pinned dependencies, so it is
    the environment the release is built from whenever it exists.

    Returns:
        Path of the PyInstaller executable to run.

    Raises:
        RuntimeError: PyInstaller is in neither the venv nor PATH.
    """
    windows = platform.system() == "Windows"
    venv = ENGINE / ".venv" / ("Scripts" if windows else "bin")
    candidate = venv / ("pyinstaller.exe" if windows else "pyinstaller")
    if candidate.is_file():
        return str(candidate)

    found = shutil.which("pyinstaller")
    if found is None:
        raise RuntimeError(
            "pyinstaller is not installed. Run: pip install -e 'packages/engine[dev]'"
        )
    print(f"Warning: no engine venv found, freezing with {found}")
    return found


def build(triple: str) -> Path:
    """Freeze the engine for one target triple.

    Args:
        triple: The Rust target triple to name the output after.

    Returns:
        The path of the built directory.

    Raises:
        RuntimeError: PyInstaller is not installed, or the build failed.
    """
    pyinstaller = find_pyinstaller()

    bundle_name = f"{NAME}-{triple}"
    target_dir = OUTPUT / bundle_name
    work = ENGINE / "build"

    # A stale directory would leave files from a previous build in the bundle,
    # and PyInstaller does not prune what it no longer produces.
    if target_dir.exists():
        shutil.rmtree(target_dir)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    command = [
        pyinstaller,
        "--onedir",
        "--clean",
        "--noconfirm",
        "--name",
        bundle_name,
        "--distpath",
        str(OUTPUT),
        "--workpath",
        str(work),
        "--specpath",
        str(work),
    ]
    for module in (*HIDDEN_IMPORTS, *stdlib_modules()):
        command += ["--hidden-import", module]
    for package in COLLECT_ALL:
        command += ["--collect-all", package]
    command.append(str(ENTRY))

    print(f"Freezing {ENTRY.name} for {triple} in onedir mode")
    result = subprocess.run(command, cwd=ENGINE, check=False)  # noqa: S603
    if result.returncode != 0:
        raise RuntimeError(f"pyinstaller failed with exit code {result.returncode}")

    executable = target_dir / executable_name(triple)
    if not executable.is_file():
        raise RuntimeError(f"expected {executable} to exist after the build")

    smoke_test(executable)
    return target_dir


def smoke_test(executable: Path) -> None:
    """Start the frozen executable and require it to reach its argument parser.

    PyInstaller reports success for a bundle that cannot import its own
    dependencies, because nothing is executed during the build. A missing
    package therefore surfaces at the user's first launch as a sidecar that
    exits immediately. ``--help`` is the cheapest run that still imports every
    module the server imports, so it is enough to catch that whole class of
    failure here rather than in the application.

    Args:
        executable: The frozen executable to run.

    Raises:
        RuntimeError: The executable did not start cleanly.
    """
    result = subprocess.run(  # noqa: S603
        [str(executable), "--help"],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        output = (result.stderr or result.stdout).strip()
        raise RuntimeError(
            f"the frozen sidecar failed to start "
            f"(exit {result.returncode}).\n{output}"
        )
    print("Smoke test passed: the frozen sidecar imports and starts")


def directory_size_mb(directory: Path) -> float:
    """Return the total size of a directory tree, in megabytes.

    Args:
        directory: The directory to measure.

    Returns:
        The size in megabytes.
    """
    total = sum(path.stat().st_size for path in directory.rglob("*") if path.is_file())
    return total / (1024 * 1024)


def main() -> int:
    """Build the sidecar.

    Returns:
        Zero on success, one on failure.
    """
    parser = argparse.ArgumentParser(description="Build the Python sidecar.")
    parser.add_argument(
        "--triple",
        default=None,
        help="Rust target triple to name the output after. Defaults to the host.",
    )
    arguments = parser.parse_args()

    try:
        triple = arguments.triple or host_triple()
        target = build(triple)
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(
        f"Built {target.relative_to(ROOT).as_posix()}/ "
        f"({directory_size_mb(target):.1f} MB, onedir)"
    )
    print(f"Executable: {executable_name(triple)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
