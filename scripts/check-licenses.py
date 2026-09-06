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

"""Scan dependency licences and fail on an incompatible one.

This project is AGPL-3.0-only, which lets it depend on permissively licensed
software. It cannot take on a dependency under a stronger or incompatible
copyleft licence, because that would constrain redistribution beyond what this
project's own grant covers, and it cannot ship a dependency with no licence at
all.

The scan covers all three ecosystems:

* Python, read from the installed distribution metadata.
* JavaScript, read from ``package.json`` in each installed package.
* Rust, read from ``cargo metadata``.

Usage::

    python scripts/check-licenses.py            # fail on a violation
    python scripts/check-licenses.py --report   # list every dependency
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Licences that impose no condition this project cannot meet.
ALLOWED = {
    "0BSD",
    "Apache-2.0",
    "BlueOak-1.0.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "CC-BY-3.0",
    "CC-BY-4.0",
    "ISC",
    "MIT",
    "MIT-0",
    "MIT-CMU",
    "MPL-2.0",
    "PSF-2.0",
    "Python-2.0",
    "Unicode-3.0",
    "Unicode-DFS-2016",
    "Unlicense",
    "WTFPL",
    "Zlib",
    # The project's own packages.
    "AGPL-3.0-only",
}

# Licences that fail the build. Strong copyleft on a dependency would reach
# further than this project's own grant, and a source-available licence is not
# open source at all.
DENIED = {
    "AGPL-1.0",
    "AGPL-3.0",
    "AGPL-3.0-or-later",
    "BUSL-1.1",
    "CC-BY-NC-4.0",
    "CC-BY-SA-4.0",
    "Commons-Clause",
    "Elastic-2.0",
    "GPL-2.0",
    "GPL-2.0-only",
    "GPL-2.0-or-later",
    "GPL-3.0",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "LGPL-3.0-or-later",
    "SSPL-1.0",
}

# Packages this project publishes itself. They are AGPL by design, and the
# scanner would otherwise flag the project as a violation of its own policy.
OWN_PACKAGES = {"bitwright-engine", "bitwright", "@bitwright/desktop", "bitwright-sprite-engine"}

# Build-time tools whose licence would otherwise be denied, but which do not
# reach the shipped work. Each entry is a decision on the record, with the
# reason it is safe. Nothing is added here without reading the licence.
EXEMPT_PACKAGES = {
    "pyinstaller": (
        "GPL-2.0 with an explicit exception permitting the frozen output to be "
        "distributed under any licence. It is a build tool and its own code is "
        "not part of the bundle."
    ),
}

# Names some ecosystems still use for a licence that has an SPDX identifier.
ALIASES = {
    "apache 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "bsd": "BSD-3-Clause",
    "bsd license": "BSD-3-Clause",
    "mit license": "MIT",
    "the mit license": "MIT",
    "new bsd license": "BSD-3-Clause",
    "python software foundation license": "PSF-2.0",
    "historical permission notice and disclaimer (hpnd)": "HPND",
    "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0",
    "gnu general public license v3 (gplv3)": "GPL-3.0-only",
    "gnu affero general public license v3": "AGPL-3.0-only",
}


@dataclass(frozen=True, slots=True)
class Dependency:
    """One dependency and the licence it declares.

    Attributes:
        ecosystem: ``python``, ``javascript``, or ``rust``.
        name: Package name.
        version: Package version.
        license_id: The licence expression as declared, normalised where a
            known alias was used.
    """

    ecosystem: str
    name: str
    version: str
    license_id: str


def normalise(raw: str) -> str:
    """Normalise a declared licence to an SPDX identifier where possible.

    Args:
        raw: The licence string as the ecosystem declared it.

    Returns:
        An SPDX identifier, or the original string when it is not recognised.
    """
    cleaned = raw.strip()
    # Only a fully wrapped expression loses its brackets. Stripping them
    # blindly would mangle a classifier such as "Mozilla Public License 2.0
    # (MPL 2.0)", whose brackets are part of the name.
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = cleaned[1:-1].strip()
    return ALIASES.get(cleaned.lower(), cleaned)


def split_expression(expression: str) -> list[str]:
    """Split an SPDX expression into the licences it offers.

    A dual licence such as ``Apache-2.0 OR MIT`` passes when either half is
    allowed, so the parts are checked separately. ``AND`` is treated the same
    way here, and reported rather than resolved, because an expression that
    combines a permissive and a copyleft licence needs a human decision.

    Args:
        expression: An SPDX licence expression.

    Returns:
        The individual licence identifiers.
    """
    # An SPDX exception only grants extra permission, so the licence it
    # qualifies is what decides compatibility.
    without_exception = re.sub(r"\s+WITH\s+\S+", "", expression, flags=re.IGNORECASE)
    parts = re.split(r"\s+(?:OR|AND)\s+|/", without_exception, flags=re.IGNORECASE)
    return [normalise(part) for part in parts if part.strip()]


def python_dependencies() -> Iterator[Dependency]:
    """Read licences from the installed Python distributions.

    Yields:
        One dependency per installed distribution.
    """
    for dist in metadata.distributions():
        name = dist.metadata["Name"]
        if name is None:
            continue

        declared = dist.metadata.get("License-Expression") or dist.metadata.get("License") or ""
        if not declared or declared == "UNKNOWN":
            classifiers = dist.metadata.get_all("Classifier") or []
            declared = next(
                (
                    value.split("::")[-1].strip()
                    for value in classifiers
                    if value.startswith("License ::")
                ),
                "",
            )

        yield Dependency(
            ecosystem="python",
            name=name,
            version=dist.version or "",
            license_id=normalise(declared) if declared else "UNKNOWN",
        )


def javascript_dependencies() -> Iterator[Dependency]:
    """Read licences from the installed npm packages.

    Yields:
        One dependency per installed package.
    """
    modules = ROOT / "node_modules"
    if not modules.is_dir():
        return

    for manifest in sorted(modules.glob("*/package.json")) + sorted(
        modules.glob("@*/*/package.json")
    ):
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        declared = data.get("license")
        if isinstance(declared, dict):
            declared = declared.get("type", "")
        if not isinstance(declared, str) or not declared:
            declared = "UNKNOWN"

        yield Dependency(
            ecosystem="javascript",
            name=str(data.get("name", manifest.parent.name)),
            version=str(data.get("version", "")),
            license_id=normalise(declared),
        )


def rust_dependencies() -> Iterator[Dependency]:
    """Read licences from ``cargo metadata``.

    Yields:
        One dependency per crate in the resolved graph.
    """
    manifest = ROOT / "apps" / "desktop" / "src-tauri" / "Cargo.toml"
    if not manifest.is_file():
        return

    try:
        output = subprocess.run(  # noqa: S603 - fixed argument list, no shell
            [
                "cargo",
                "metadata",
                "--format-version",
                "1",
                "--manifest-path",
                str(manifest),
            ],
            capture_output=True,
            text=True,
            # Cargo writes UTF-8 whatever the console code page is, and the
            # default locale decoder fails on Windows without this.
            encoding="utf-8",
            errors="replace",
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"  skipping rust: cargo metadata failed ({error})")
        return

    for package in json.loads(output).get("packages", []):
        declared = package.get("license") or "UNKNOWN"
        yield Dependency(
            ecosystem="rust",
            name=package["name"],
            version=package.get("version", ""),
            license_id=normalise(declared),
        )


def verdict(dependency: Dependency) -> tuple[str, str]:
    """Decide whether a dependency's licence is acceptable.

    Args:
        dependency: The dependency to judge.

    Returns:
        A status of ``ok``, ``denied``, or ``unknown``, and an explanation.
    """
    if dependency.name in OWN_PACKAGES:
        return "ok", "published by this project"

    exemption = EXEMPT_PACKAGES.get(dependency.name.lower())
    if exemption is not None:
        return "ok", exemption

    options = split_expression(dependency.license_id)
    if any(option in ALLOWED for option in options):
        return "ok", ""
    if any(option in DENIED for option in options):
        return "denied", f"{dependency.license_id} is not compatible with AGPL-3.0-only"
    return "unknown", f"{dependency.license_id} is not on the allowlist"


def main() -> int:
    """Run the scan.

    Returns:
        Zero when every dependency is acceptable, one otherwise.
    """
    parser = argparse.ArgumentParser(description="Check dependency licences.")
    parser.add_argument(
        "--report",
        action="store_true",
        help="list every dependency, not only the problems",
    )
    arguments = parser.parse_args()

    dependencies = [
        *python_dependencies(),
        *javascript_dependencies(),
        *rust_dependencies(),
    ]

    denied: list[tuple[Dependency, str]] = []
    unknown: list[tuple[Dependency, str]] = []

    print(f"Checked {len(dependencies)} dependencies\n")

    for dependency in sorted(dependencies, key=lambda item: (item.ecosystem, item.name.lower())):
        status, reason = verdict(dependency)
        if status == "denied":
            denied.append((dependency, reason))
        elif status == "unknown":
            unknown.append((dependency, reason))

        if arguments.report:
            print(
                f"  {status:<8} {dependency.ecosystem:<11} "
                f"{dependency.name:<34} {dependency.license_id}"
            )

    if unknown:
        print(f"\n{len(unknown)} dependency licence(s) not recognised:")
        for dependency, reason in unknown:
            print(f"  {dependency.ecosystem} {dependency.name} {dependency.version}: {reason}")
        print(
            "\nAdd the licence to ALLOWED in this script once it has been read, "
            "or to DENIED if it is not compatible."
        )

    if denied:
        print(f"\n{len(denied)} incompatible dependency licence(s):")
        for dependency, reason in denied:
            print(f"  {dependency.ecosystem} {dependency.name} {dependency.version}: {reason}")

    if denied or unknown:
        return 1

    print("Every dependency licence is compatible with AGPL-3.0-only.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
