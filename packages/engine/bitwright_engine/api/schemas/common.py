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

"""Response models shared across routes."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that speaks camelCase on the wire.

    Python keeps snake_case and TypeScript keeps camelCase, so neither side has
    to carry the other's convention. Requests are accepted under either name,
    which keeps hand written curl calls and the generated client both working.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class HealthResponse(CamelModel):
    """Liveness of the sidecar.

    Deliberately thin. This route is the only unauthenticated one, so it says
    that the process is up and which build it is, and nothing about where the
    user's data lives or what the process can reach.

    Attributes:
        status: ``"ok"`` once the process can serve requests.
        version: Engine version.
    """

    status: str = Field(examples=["ok"])
    version: str


class ErrorResponse(CamelModel):
    """A failure the user interface can translate.

    The ``code`` is a stable key, not prose. The frontend looks it up in the
    ``errors`` translation namespace, so that the message reaches the user in
    their own language. ``message`` is a developer-facing fallback in English.

    Attributes:
        code: Stable reason code, for example ``conform.bad_image``.
        message: English description, for logs and for unmapped codes.
    """

    code: str
    message: str
