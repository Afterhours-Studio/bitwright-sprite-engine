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

"""Bitwright - Sprite Engine.

The image pipeline behind the Bitwright pixel art editor. This package runs as
a sidecar process next to the desktop application and exposes its batch image
work — conform, palette extraction, export — over a loopback HTTP API.

Nothing interactive lives here. The document, the canvas and the agent-facing
tools are owned by the shell, which keeps a draw call a direct event rather
than a round trip through this process.
"""

from bitwright_engine.version import __version__

__all__ = ["__version__"]
