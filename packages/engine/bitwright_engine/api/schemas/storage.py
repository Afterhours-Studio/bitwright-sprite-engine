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

"""Request and response models for the storage route.

Paths travel as strings. A path is what the user typed or picked, and it is
rendered back to them verbatim, so it is never reshaped on the way through.
"""

from __future__ import annotations

from bitwright_engine.api.schemas.common import CamelModel


class StorageInfo(CamelModel):
    """One data root, as the settings screen sees it.

    Attributes:
        root: The directory that holds everything the application writes: the
            database, the sprites, and the imported reference images.
        sprites_dir: Where sprites are written.
        default_root: The per-user default, so the interface can offer to go
            back to it.
        is_default: Whether ``root`` is that default.
        free_bytes: Free space on the volume behind ``root``, or null when the
            volume could not be read. The interface shows it, so that a volume
            with no room left is visible before the root is adopted.
        total_bytes: Size of that volume, or null for the same reason.
        used_bytes: Bytes already taken by the files under this root.
    """

    root: str
    sprites_dir: str
    default_root: str
    is_default: bool
    free_bytes: int | None
    total_bytes: int | None
    used_bytes: int


class StorageRootBody(CamelModel):
    """A directory the user chose.

    Attributes:
        path: Absolute path to the directory. Validated by the engine before
            anything is written to it.
    """

    path: str


class StorageChangeResponse(CamelModel):
    """The outcome of moving the data root.

    Attributes:
        current: The root now in use.
        previous: The root that was in use, described as it stands after the
            change, so that the interface can say how much was left behind.
        data_moved: Always false. The application never moves a user's library
            on its own; what is already written stays where it is, and the
            gallery will no longer find it. The field exists so the interface
            states this rather than assuming it.
    """

    current: StorageInfo
    previous: StorageInfo
    data_moved: bool = False
