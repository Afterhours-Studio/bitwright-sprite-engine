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

"""Logging setup for the sidecar process.

The Tauri shell captures the sidecar's standard streams, so records are written
to stderr in a single line format that survives being read back from a log
file.
"""

from __future__ import annotations

import logging
import sys

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s %(message)s"


def configure_logging(level: str = "INFO") -> None:
    """Install the sidecar logging configuration.

    Calling this more than once replaces the handlers rather than adding to
    them, so repeated calls in tests do not duplicate output.

    Args:
        level: Minimum level to emit, as a standard level name.
    """
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    root.addHandler(handler)
    root.setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    """Return the logger for a module.

    Args:
        name: Usually the module's ``__name__``.

    Returns:
        The named logger.
    """
    return logging.getLogger(name)
