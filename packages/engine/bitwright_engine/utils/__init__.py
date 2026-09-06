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

"""Shared helpers that do not belong to a single subsystem."""

from bitwright_engine.utils.images import from_png_bytes, placeholder, to_png_bytes
from bitwright_engine.utils.logging import configure_logging, get_logger
from bitwright_engine.utils.watchdog import install_parent_death_signal, watch_parent

__all__ = [
    "configure_logging",
    "from_png_bytes",
    "get_logger",
    "install_parent_death_signal",
    "placeholder",
    "to_png_bytes",
    "watch_parent",
]
