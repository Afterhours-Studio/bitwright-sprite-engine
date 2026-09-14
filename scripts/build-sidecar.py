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

Two checks run after the freeze. The first starts the executable and requires it
to reach its argument parser, which catches a bundle that cannot import its own
dependencies. The second asks the frozen binary to load torch out of an
installed GPU runtime, which is the one thing about this design that could not
be settled by reasoning: torch is not in the bundle, it is downloaded into the
user's data folder afterwards. See
docs/architecture/decisions/0011-gpu-runtime-installation.md.

Usage::

    python scripts/build-sidecar.py
    python scripts/build-sidecar.py --triple x86_64-unknown-linux-gnu
    python scripts/build-sidecar.py --runtime-root /tmp/bitwright-runtime-check
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from collections.abc import Iterator
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
# the standard library is taken whole instead of guessed at - every public
# module, and every public module inside one, since a package does not
# necessarily import what lives under it.
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


def submodules(name: str) -> Iterator[str]:
    """Yield every public submodule of a standard library package.

    Read off the file system rather than by importing anything. Importing to
    enumerate would run module level code for packages this build has no reason
    to execute, and some of them - ``curses`` on Windows, for one - cannot be
    imported here at all.

    Args:
        name: A top level standard library module name.

    Yields:
        Dotted names of its public submodules, at any depth. Nothing at all when
        the module is not a package.
    """
    try:
        spec = importlib.util.find_spec(name)
    except (ImportError, ValueError):
        return
    if spec is None or not spec.submodule_search_locations:
        return
    for location in spec.submodule_search_locations:
        yield from _walk(name, Path(location))


def _walk(prefix: str, directory: Path) -> Iterator[str]:
    """Yield the public modules in a package directory, recursively.

    Args:
        prefix: Dotted name of the package the directory holds.
        directory: The package directory.

    Yields:
        Dotted module names.
    """
    if not directory.is_dir():
        return
    for entry in sorted(directory.iterdir()):
        if entry.name.startswith("_"):
            continue
        if entry.is_dir():
            if (entry / "__init__.py").is_file():
                yield f"{prefix}.{entry.name}"
                yield from _walk(f"{prefix}.{entry.name}", entry)
        elif entry.suffix == ".py":
            yield f"{prefix}.{entry.stem}"


def stdlib_modules() -> tuple[str, ...]:
    """Return the standard library modules to force into the bundle.

    Submodules are named one by one rather than left to the package that holds
    them. ``--hidden-import unittest`` gets ``unittest`` and nothing under it,
    because PyInstaller still works by following imports from there and
    ``unittest/__init__.py`` does not import ``unittest.mock``. torch does, on
    line 12 of ``torch/_guards.py``, which is how a bundle that passed its smoke
    test came to have no ``unittest.mock`` in it. Taking the top level names
    alone yields roughly two hundred modules; taking what is under them yields
    roughly five hundred, and that is the standard library this comment claims.

    Private modules are left out at every level: they are pulled in by the
    public ones that need them, and naming them directly is how a build ends up
    depending on an implementation detail of one interpreter version.

    Returns:
        Module names, sorted.
    """
    names: set[str] = set()
    for name in sys.stdlib_module_names:
        if name.startswith("_") or name in STDLIB_EXCLUDED:
            continue
        names.add(name)
        names.update(submodules(name))
    return tuple(sorted(names))


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


def build(triple: str, runtime_root: Path | None = None) -> Path:
    """Freeze the engine for one target triple.

    Args:
        triple: The Rust target triple to name the output after.
        runtime_root: Data root the GPU runtime check should look under.
            Defaults to the one this machine's settings resolve to.

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
    runtime_test(executable, runtime_root)
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


def last_json_line(output: str) -> dict[str, object]:
    """Return the last line of some output that parses as a JSON object.

    The sidecar logs to the same streams it reports on, so the report is found
    rather than assumed to be the whole of stdout.

    Args:
        output: Captured standard output.

    Returns:
        The parsed object.

    Raises:
        RuntimeError: No line parsed as a JSON object.
    """
    for line in reversed(output.splitlines()):
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError(f"the frozen sidecar printed no runtime report.\n{output.strip()}")


def runtime_test(executable: Path, root: Path | None = None) -> None:
    """Require the frozen bundle to load torch from an installed GPU runtime.

    This is the question ADR 0011 reasoned about and could not answer: torch is
    deliberately not in the bundle, so whether a frozen interpreter can import
    it out of the directory the user installed it into is not settled by the
    build succeeding, nor by a torch being importable on the build machine.
    Running the **frozen executable**, which carries only its own archive on
    ``sys.path``, is what makes the question honest, and the report says which
    directory the module was loaded from so that the answer can be checked
    rather than believed.

    A machine with no runtime installed is not a build failure. It is four
    gigabytes a build agent has no reason to hold, so the check says what it
    could not prove and moves on. It fails only when a runtime is there and does
    not work, which is the case that must never ship.

    Args:
        executable: The frozen executable to run.
        root: Data root to look for the runtime under. Defaults to the one this
            machine's settings resolve to.

    Raises:
        RuntimeError: The report could not be read, or the runtime is installed
            and unusable.
    """
    environment = dict(os.environ)
    if root is not None:
        environment["BITWRIGHT_DATA_ROOT"] = str(root)

    result = subprocess.run(  # noqa: S603
        [str(executable), "--report-runtime"],
        capture_output=True,
        text=True,
        timeout=600,
        env=environment,
        check=False,
    )
    if result.returncode != 0:
        output = (result.stderr or result.stdout).strip()
        raise RuntimeError(
            f"the frozen sidecar could not report on its runtime "
            f"(exit {result.returncode}).\n{output}"
        )

    report = last_json_line(result.stdout)
    target = report.get("target")

    if not report.get("supported"):
        print(
            f"Runtime check skipped: no wheels are pinned for {target}. "
            f"Not proven: that a frozen bundle can import torch on this target."
        )
        return

    if not report.get("installed"):
        print(
            f"Runtime check skipped: no GPU runtime is installed under "
            f"{report.get('installDir')}. Proven: the frozen bundle starts and "
            f"runs activation. Not proven: that it can import torch. Install a "
            f"runtime from Settings, or point BITWRIGHT_DATA_ROOT at one, and "
            f"build again to settle it."
        )
        return

    if not report.get("torchImportable"):
        raise RuntimeError(
            f"the frozen sidecar found an installed runtime and could not import "
            f"torch from it: {report.get('probeDetail') or 'no detail reported'}\n"
            f"activated path: {report.get('activatedPath')}\n"
            f"{result.stderr.strip()}"
        )

    activated = str(report.get("activatedPath") or "")
    location = str(report.get("torchLocation") or "")
    if not activated or not location.startswith(activated):
        raise RuntimeError(
            f"the frozen sidecar imported a torch that did not come from the "
            f"installed runtime.\nactivated path: {activated or 'none'}\n"
            f"torch loaded from: {location or 'unknown'}"
        )

    if not report.get("computeOk"):
        raise RuntimeError(
            f"the frozen sidecar imported torch from the installed runtime and "
            f"could not compute on {report.get('computeDevice') or 'any device'}: "
            f"{report.get('computeDetail') or 'no detail reported'}\n"
            f"{report.get('computeMessage') or result.stderr.strip()}"
        )

    print(
        f"Runtime check passed: the frozen sidecar imported torch "
        f"{report.get('torchVersion')} from {location} and computed on "
        f"{report.get('computeDevice')}."
    )
    print(
        f"  Proven for the {report.get('installedAccelerator')} runtime on "
        f"{target}. Other variants and other targets are unproven."
    )


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
    parser.add_argument(
        "--runtime-root",
        default=None,
        type=Path,
        help=(
            "Data root to look for an installed GPU runtime under, for the "
            "post-build check that the frozen bundle can import torch. Defaults "
            "to this machine's own data root."
        ),
    )
    arguments = parser.parse_args()

    try:
        triple = arguments.triple or host_triple()
        target = build(triple, arguments.runtime_root)
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
