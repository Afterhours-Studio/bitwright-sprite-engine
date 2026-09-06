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

"""The built-in provider catalogue.

THE WIRE FORMAT IS OPENAI COMPATIBLE, FOR EVERY ENTRY HERE AND FOR THE CUSTOM
KIND. That is the whole contract, and it is stated plainly because a user
pointing this application at their own endpoint has to know what that endpoint
must speak:

* ``GET  {base_url}/models`` answers ``{"data": [{"id": ...}, ...]}``.
* ``POST {base_url}/images/generations`` accepts ``{"model", "prompt", ...}``.
* The credential is presented in a header, by default ``Authorization: Bearer
  <key>``.

Every preset below is chosen because it speaks that shape unmodified, so one
client works against all of them and against an aggregator or router that
imitates them. A provider with its own bespoke protocol does not belong in this
list; it belongs behind a router that translates to this shape.

The catalogue is data, not behaviour. Adding a provider is one entry here, and
it needs no change anywhere else.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class AuthScheme(StrEnum):
    """How a provider expects the credential to be presented.

    Attributes:
        BEARER: ``Authorization: Bearer <key>``. What almost everything uses.
        HEADER: The key is the whole value of a named header, such as
            ``x-api-key: <key>``. Used by providers that predate the bearer
            convention, and by some self-hosted routers.
        NONE: The endpoint needs no credential. A router running on this
            machine is the case that matters; without this, such an endpoint
            could never be marked ready.
    """

    BEARER = "bearer"
    HEADER = "header"
    NONE = "none"


class ProviderKind(StrEnum):
    """Whether a provider came from the catalogue or from the user.

    Attributes:
        PRESET: Chosen from :data:`PRESETS`. The base URL and the request shape
            are known, so the user supplies only a key and a model.
        CUSTOM: The user supplied the base URL themselves. Used for an
            aggregator, a router, or anything self-hosted that speaks the
            OpenAI compatible shape described in this module's docstring.
    """

    PRESET = "preset"
    CUSTOM = "custom"


@dataclass(frozen=True, slots=True)
class ProviderPreset:
    """A provider whose endpoint and request shape are known in advance.

    Attributes:
        preset_id: Stable identifier, stored in the configuration file. Never
            translated and never changed once shipped.
        name: Default display name. The user may rename their copy.
        base_url: Root the request paths are appended to. Written without a
            trailing slash, though :func:`~bitwright_engine.providers.config.join_url`
            tolerates one either way.
        default_model: Model identifier proposed when the provider is added.
            A starting point, not a restriction.
        auth_scheme: How this provider expects the credential.
        auth_header: Header name when ``auth_scheme`` is
            :attr:`AuthScheme.HEADER`, empty otherwise.
        documentation_url: Where the user gets a key and reads the model list.
    """

    preset_id: str
    name: str
    base_url: str
    default_model: str
    auth_scheme: AuthScheme
    auth_header: str
    documentation_url: str


CUSTOM_PRESET_ID = "custom"
"""Reserved identifier. Never a key in :data:`PRESETS`."""


PRESETS: tuple[ProviderPreset, ...] = (
    ProviderPreset(
        preset_id="openai",
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        default_model="gpt-image-1",
        auth_scheme=AuthScheme.BEARER,
        auth_header="",
        documentation_url="https://platform.openai.com/api-keys",
    ),
    ProviderPreset(
        preset_id="openrouter",
        name="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        default_model="",
        auth_scheme=AuthScheme.BEARER,
        auth_header="",
        documentation_url="https://openrouter.ai/keys",
    ),
    ProviderPreset(
        preset_id="together",
        name="Together AI",
        base_url="https://api.together.xyz/v1",
        default_model="black-forest-labs/FLUX.1-schnell",
        auth_scheme=AuthScheme.BEARER,
        auth_header="",
        documentation_url="https://api.together.ai/settings/api-keys",
    ),
    ProviderPreset(
        preset_id="deepinfra",
        name="DeepInfra",
        base_url="https://api.deepinfra.com/v1/openai",
        default_model="black-forest-labs/FLUX-1-schnell",
        auth_scheme=AuthScheme.BEARER,
        auth_header="",
        documentation_url="https://deepinfra.com/dash/api_keys",
    ),
)
"""The providers offered by name.

Four entries, and each earns its place for a different reason:

* **OpenAI** is the shape every other entry imitates, so it is the reference
  against which "OpenAI compatible" is checked.
* **OpenRouter** is the router case the user asked for: one key in front of
  many models from many vendors, which is exactly what someone reaches for
  when they have no GPU and do not want an account per vendor.
* **Together AI** hosts the open image models this application actually wants
  (FLUX, SDXL) rather than only chat models.
* **DeepInfra** hosts the same class of image model, and its base URL carries a
  path prefix (``/v1/openai``). That is not incidental: it keeps a real
  path-prefixed base URL in the shipped data, so the URL joining stays honest.

Deliberately small. A longer list is a maintenance burden that goes stale, and
anything missing is one custom entry away.
"""


PRESETS_BY_ID: dict[str, ProviderPreset] = {preset.preset_id: preset for preset in PRESETS}
"""Lookup for :data:`PRESETS`, keyed by :attr:`ProviderPreset.preset_id`."""


def get_preset(preset_id: str) -> ProviderPreset | None:
    """Return one catalogue entry.

    Args:
        preset_id: The identifier to look up.

    Returns:
        The preset, or ``None`` when the catalogue does not hold it.
    """
    return PRESETS_BY_ID.get(preset_id)
