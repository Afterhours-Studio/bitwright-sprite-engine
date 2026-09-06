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

"""Stable reason codes for provider configuration and connection testing.

Every code here has a matching entry in both ``locales/en/errors.json`` and
``locales/vi/errors.json``. They are constants rather than inline strings so
that a rename cannot leave a route returning a code no translation exists for:
the tests assert that this module and the two locale files agree.

The ``backend.remote.`` prefix is deliberate. These failures all belong to the
remote backend, and the frontend already translates that namespace.
"""

from __future__ import annotations

PREFIX = "backend.remote."
"""Namespace every code in this module lives under."""

# --- Configuration is incomplete or malformed -------------------------------

ENDPOINT_MISSING = "backend.remote.endpoint_missing"
"""No provider is configured and no endpoint was supplied by environment."""

API_KEY_MISSING = "backend.remote.api_key_missing"
"""The provider needs a credential and none is stored for it."""

NO_ACTIVE_PROVIDER = "backend.remote.no_active_provider"
"""Providers exist, but none of them is selected as the active one."""

PROVIDER_UNKNOWN = "backend.remote.provider_unknown"
"""The identifier does not name a stored provider."""

UNKNOWN_PRESET = "backend.remote.unknown_preset"
"""A preset provider was requested by a name the catalogue does not hold."""

NAME_MISSING = "backend.remote.name_missing"
"""The provider was saved without a display name."""

MODEL_MISSING = "backend.remote.model_missing"
"""The provider was saved without a model name to send with requests."""

INVALID_BASE_URL = "backend.remote.invalid_base_url"
"""The base URL is not an absolute http or https URL."""

INSECURE_URL = "backend.remote.insecure_url"
"""Plain http to a host that is not loopback would put the key on the wire."""

INVALID_HEADER = "backend.remote.invalid_header"
"""A header name or value contains something that cannot go in a header."""

LIMIT_REACHED = "backend.remote.limit_reached"
"""No more providers may be stored."""

# --- Storage ----------------------------------------------------------------

SECRET_READ_FAILED = "backend.remote.secret_read_failed"
"""The credential store refused to hand back a stored key."""

SECRET_WRITE_FAILED = "backend.remote.secret_write_failed"
"""The credential store refused to keep a key."""

STORE_WRITE_FAILED = "backend.remote.store_write_failed"
"""The provider list could not be written to disk."""

# --- Connection test outcomes ----------------------------------------------

REACHABLE = "backend.remote.reachable"
"""The endpoint answered and accepted the credential. The success code."""

UNREACHABLE = "backend.remote.unreachable"
"""The host could not be resolved or routed to."""

REFUSED = "backend.remote.refused"
"""Something answered at that address and closed the connection."""

TIMEOUT = "backend.remote.timeout"
"""The endpoint accepted the connection but did not answer in time."""

BAD_KEY = "backend.remote.bad_key"
"""The endpoint rejected the credential."""

FORBIDDEN = "backend.remote.forbidden"
"""The credential was recognised but is not allowed to do this."""

NOT_FOUND = "backend.remote.not_found"
"""The base URL is wrong: the endpoint has no model listing there."""

REJECTED = "backend.remote.rejected"
"""The provider refused the request itself, rather than the transport."""

NO_ALLOWANCE = "backend.remote.no_allowance"
"""The plan has no allowance for this model at all, rather than none left."""

RATE_LIMITED = "backend.remote.rate_limited"
"""The provider is throttling this key."""

SERVER_ERROR = "backend.remote.server_error"
"""The provider failed on its own side."""

UNEXPECTED_SHAPE = "backend.remote.unexpected_shape"
"""Something answered, but not with an OpenAI compatible model listing."""

REQUEST_FAILED = "backend.remote.request_failed"
"""Anything else the provider refused with."""

ALL_CODES: frozenset[str] = frozenset(
    {
        ENDPOINT_MISSING,
        API_KEY_MISSING,
        NO_ACTIVE_PROVIDER,
        PROVIDER_UNKNOWN,
        UNKNOWN_PRESET,
        NAME_MISSING,
        MODEL_MISSING,
        INVALID_BASE_URL,
        INSECURE_URL,
        INVALID_HEADER,
        LIMIT_REACHED,
        REJECTED,
        SECRET_READ_FAILED,
        SECRET_WRITE_FAILED,
        STORE_WRITE_FAILED,
        REACHABLE,
        UNREACHABLE,
        REFUSED,
        TIMEOUT,
        BAD_KEY,
        FORBIDDEN,
        NOT_FOUND,
        RATE_LIMITED,
        NO_ALLOWANCE,
        SERVER_ERROR,
        UNEXPECTED_SHAPE,
        REQUEST_FAILED,
    }
)
"""Every code this module defines, for the locale parity test."""
