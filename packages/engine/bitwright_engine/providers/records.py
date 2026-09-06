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

"""What a configured provider is, and what makes one valid.

A provider is a named configuration: an identifier, a display name, where to
send the request, which model to ask for, and how to present the credential.
The credential itself is deliberately not part of this record. It lives in
:mod:`bitwright_engine.providers.secrets`, keyed by
:attr:`ProviderConfig.provider_id`, so that the record can be serialised,
logged, and returned over the API without any risk of carrying a key with it.

Validation lives here rather than in the API layer, because the same rules have
to hold for a record loaded from a file the user can edit by hand.
"""

from __future__ import annotations

import ipaddress
import re
import secrets as random_secrets
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from bitwright_engine.providers import codes
from bitwright_engine.providers.catalogue import AuthScheme, ProviderKind, get_preset

MAX_PROVIDERS = 16
"""Most providers that may be stored. A person configures two or three."""

MAX_NAME = 64
"""Longest display name."""

MAX_URL = 512
"""Longest base URL."""

MAX_MODEL = 200
"""Longest model identifier.

Vendor-prefixed names such as ``black-forest-labs/FLUX.1-schnell`` are why this
is not shorter.
"""

MAX_EXTRA_HEADERS = 8
"""Most provider-required headers beyond the credential."""

MIN_TIMEOUT_S = 1.0
"""Shortest request timeout accepted."""

MAX_TIMEOUT_S = 900.0
"""Longest request timeout accepted."""

DEFAULT_TIMEOUT_S = 120.0
"""Request timeout used when the caller names none."""

_ID_PATTERN = re.compile(r"\A[a-z0-9][a-z0-9_-]{0,63}\Z")
"""Shape of a provider identifier.

Deliberately the shape the shell already accepts in a URL path, because the
identifier travels in one. Anything holding a slash, a dot, a percent escape,
or a query separator is not an identifier.
"""

_HEADER_NAME_PATTERN = re.compile(r"\A[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}\Z")
"""An RFC 9110 token, which is what a header field name is."""

_HEADER_VALUE_PATTERN = re.compile(r"\A[\x20-\x7e]{0,1024}\Z")
"""Printable ASCII only.

A carriage return or a newline in a header value is header injection: it ends
the field early and lets the rest of the string be read as further headers.
Checked at the edge rather than trusting the HTTP client to notice.
"""

_LOOPBACK_NAMES = frozenset({"localhost"})
"""Host names that always mean this machine."""


class ProviderError(ValueError):
    """A provider configuration that cannot be used.

    Attributes:
        code: Stable reason code from :mod:`bitwright_engine.providers.codes`,
            which the user interface translates.
    """

    def __init__(self, code: str) -> None:
        """Create the error.

        Args:
            code: The stable reason code. It is also the exception message, so
                that a stray log line carries the code and nothing else.
        """
        super().__init__(code)
        self.code = code


def new_provider_id() -> str:
    """Return a fresh provider identifier.

    Random rather than derived from the display name. Two providers may share a
    name, a name may be edited afterwards, and the identifier is what the
    stored credential is keyed by, so it has to be stable and collision free.

    Returns:
        An identifier matching the shape :func:`is_valid_provider_id` accepts.
    """
    return f"p{random_secrets.token_hex(8)}"


def is_valid_provider_id(value: str) -> bool:
    """Report whether a string may be used as a provider identifier.

    Args:
        value: The candidate identifier.

    Returns:
        True when the value has the required shape.
    """
    return bool(_ID_PATTERN.fullmatch(value))


def is_loopback_host(host: str) -> bool:
    """Report whether a host name or address refers to this machine.

    Args:
        host: Host portion of a URL, without the port.

    Returns:
        True for ``localhost``, any ``127.0.0.0/8`` address, and ``::1``.
    """
    lowered = host.lower().strip("[]")
    if lowered in _LOOPBACK_NAMES or lowered.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(lowered).is_loopback
    except ValueError:
        return False


def normalise_base_url(raw: str) -> str:
    """Validate a base URL and put it in one canonical form.

    Trailing slashes are removed here, once, so that every path join downstream
    is a plain concatenation and cannot produce a doubled slash. A path prefix
    is kept, because several providers have one: DeepInfra's OpenAI compatible
    surface lives under ``/v1/openai``, and truncating that would send every
    request to the wrong place.

    Plain ``http`` is refused for anything that is not this machine. The API key
    travels in a request header, and over cleartext http to a remote host that
    is a credential handed to every device on the path. Loopback is exempt,
    because a router running on this machine has nothing to intercept.

    Args:
        raw: The URL as the user typed it.

    Returns:
        The URL with no trailing slash, no query, and no fragment.

    Raises:
        ProviderError: The URL is not usable as a base URL.
    """
    value = raw.strip()
    if not value or len(value) > MAX_URL:
        raise ProviderError(codes.INVALID_BASE_URL)

    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        raise ProviderError(codes.INVALID_BASE_URL)

    # A URL with no host is not something a request can be aimed at, and
    # urlsplit happily produces one for input such as "https://".
    try:
        host = parsed.hostname
    except ValueError as error:
        raise ProviderError(codes.INVALID_BASE_URL) from error
    if not host:
        raise ProviderError(codes.INVALID_BASE_URL)

    # A query or a fragment on a *base* URL means a full request URL was
    # pasted. Appending a path to that produces nonsense, so it is refused
    # where the mistake was made rather than at request time.
    if parsed.query or parsed.fragment:
        raise ProviderError(codes.INVALID_BASE_URL)

    if parsed.scheme == "http" and not is_loopback_host(host):
        raise ProviderError(codes.INSECURE_URL)

    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def join_url(base: str, path: str) -> str:
    """Append a request path to a base URL.

    Written out rather than using :func:`urllib.parse.urljoin`, which resolves
    the path against the base the way a browser resolves a link: ``urljoin`` of
    ``https://host/v1`` and ``models`` is ``https://host/models``, silently
    losing the ``/v1``. Every provider with a path prefix would break that way.

    Args:
        base: Base URL, with or without a trailing slash.
        path: Request path, with or without a leading slash.

    Returns:
        The joined URL, with exactly one slash between the two parts.
    """
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def mask_key(key: str) -> str:
    """Return a hint that identifies a stored key without revealing it.

    Enough to tell two keys apart in a list, never enough to reconstruct one. A
    key too short to spare four characters is shown as asterisks alone, because
    revealing half of a short secret is worse than revealing none of it.

    Args:
        key: The credential.

    Returns:
        The masked hint, or an empty string when there is no key.
    """
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return "****" + key[-4:]


def _clean_headers(raw: dict[str, str]) -> dict[str, str]:
    """Validate and copy a set of extra request headers.

    Args:
        raw: Header names mapped to values, as supplied by the caller.

    Returns:
        A new dictionary holding the same pairs, stripped.

    Raises:
        ProviderError: There are too many headers, or one of them holds
            something that cannot go in a header.
    """
    if len(raw) > MAX_EXTRA_HEADERS:
        raise ProviderError(codes.INVALID_HEADER)

    cleaned: dict[str, str] = {}
    for name, value in raw.items():
        key = name.strip()
        text = value.strip()
        if not _HEADER_NAME_PATTERN.fullmatch(key) or not _HEADER_VALUE_PATTERN.fullmatch(text):
            raise ProviderError(codes.INVALID_HEADER)
        cleaned[key] = text
    return cleaned


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    """One configured provider, without its credential.

    Attributes:
        provider_id: Stable identifier. Also the key the credential is stored
            under, which is why it never changes once assigned.
        name: Display name, chosen by the user.
        kind: Whether this came from the catalogue or from the user.
        base_url: Canonical base URL, with no trailing slash.
        model: Model identifier sent with every generation request.
        preset_id: Catalogue entry this was created from, empty for a custom
            provider. Kept so the interface can still show which preset a
            renamed provider came from.
        auth_scheme: How the credential is presented.
        auth_header: Header name when ``auth_scheme`` is
            :attr:`~bitwright_engine.providers.catalogue.AuthScheme.HEADER`.
        extra_headers: Further headers the provider requires, such as the
            attribution headers some routers ask for.
        timeout_s: Request timeout in seconds.
    """

    provider_id: str
    name: str
    kind: ProviderKind
    base_url: str
    model: str
    preset_id: str = ""
    auth_scheme: AuthScheme = AuthScheme.BEARER
    auth_header: str = ""
    extra_headers: dict[str, str] = field(default_factory=dict)
    timeout_s: float = DEFAULT_TIMEOUT_S

    @property
    def needs_key(self) -> bool:
        """Whether this provider cannot be used without a credential.

        Returns:
            True unless the provider is configured to send no credential.
        """
        return self.auth_scheme is not AuthScheme.NONE

    def headers(self, api_key: str) -> dict[str, str]:
        """Build the request headers for this provider.

        The credential is applied last, so a stray ``Authorization`` among
        :attr:`extra_headers` cannot displace it.

        Args:
            api_key: The credential, or an empty string when there is none.

        Returns:
            Headers to send with a request. The credential appears only in the
            returned dictionary, and is never held on the instance.
        """
        built = dict(self.extra_headers)
        built["Accept"] = "application/json"

        if not api_key:
            return built

        match self.auth_scheme:
            case AuthScheme.BEARER:
                built["Authorization"] = f"Bearer {api_key}"
            case AuthScheme.HEADER:
                if self.auth_header:
                    built[self.auth_header] = api_key
            case AuthScheme.NONE:
                pass

        return built

    def to_json(self) -> dict[str, Any]:
        """Serialise this record for the configuration file.

        Returns:
            A JSON-safe dictionary. It holds no credential, by construction:
            the credential is not a field of this class.
        """
        return {
            "id": self.provider_id,
            "name": self.name,
            "kind": self.kind.value,
            "presetId": self.preset_id,
            "baseUrl": self.base_url,
            "model": self.model,
            "authScheme": self.auth_scheme.value,
            "authHeader": self.auth_header,
            "extraHeaders": dict(self.extra_headers),
            "timeoutS": self.timeout_s,
        }

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> ProviderConfig:
        """Rebuild a record from the configuration file.

        The file sits on a disk the user can edit, so every field goes through
        exactly the checks one typed into the interface would.

        Args:
            raw: One entry from the ``providers`` array.

        Returns:
            The record.

        Raises:
            ProviderError: The entry is not a usable provider.
        """
        headers_raw = raw.get("extraHeaders")
        headers = headers_raw if isinstance(headers_raw, dict) else {}
        return build_provider(
            provider_id=str(raw.get("id", "")),
            name=str(raw.get("name", "")),
            kind=str(raw.get("kind", ProviderKind.CUSTOM.value)),
            preset_id=str(raw.get("presetId", "")),
            base_url=str(raw.get("baseUrl", "")),
            model=str(raw.get("model", "")),
            auth_scheme=str(raw.get("authScheme", AuthScheme.BEARER.value)),
            auth_header=str(raw.get("authHeader", "")),
            extra_headers={str(key): str(value) for key, value in headers.items()},
            timeout_s=float(raw.get("timeoutS", DEFAULT_TIMEOUT_S)),
        )


def build_provider(
    *,
    provider_id: str,
    name: str,
    kind: str,
    preset_id: str = "",
    base_url: str = "",
    model: str = "",
    auth_scheme: str = AuthScheme.BEARER.value,
    auth_header: str = "",
    extra_headers: dict[str, str] | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> ProviderConfig:
    """Validate loose input and produce a provider record.

    The single entry point for building a record, so a value arriving from the
    API, from the configuration file, or from a test goes through the same
    checks. A preset fills in whatever the caller left blank: the point of
    choosing one is that its base URL and credential scheme are already known.

    Args:
        provider_id: Identifier to keep, or an empty string to assign a fresh
            one.
        name: Display name.
        kind: ``preset`` or ``custom``.
        preset_id: Catalogue entry, required when ``kind`` is ``preset``.
        base_url: Base URL. May be empty for a preset, which supplies its own.
        model: Model identifier to send with requests.
        auth_scheme: ``bearer``, ``header``, or ``none``.
        auth_header: Header name, required when ``auth_scheme`` is ``header``.
        extra_headers: Further headers the provider requires.
        timeout_s: Request timeout in seconds, clamped to a usable range.

    Returns:
        A validated record.

    Raises:
        ProviderError: Some field is missing or unusable. The code names which.
    """
    try:
        resolved_kind = ProviderKind(kind)
    except ValueError as error:
        raise ProviderError(codes.UNKNOWN_PRESET) from error

    preset = None
    if resolved_kind is ProviderKind.PRESET:
        preset = get_preset(preset_id)
        if preset is None:
            raise ProviderError(codes.UNKNOWN_PRESET)

    resolved_id = provider_id.strip() or new_provider_id()
    if not is_valid_provider_id(resolved_id):
        raise ProviderError(codes.PROVIDER_UNKNOWN)

    resolved_name = name.strip() or (preset.name if preset is not None else "")
    if not resolved_name or len(resolved_name) > MAX_NAME:
        raise ProviderError(codes.NAME_MISSING)

    resolved_url = base_url.strip() or (preset.base_url if preset is not None else "")
    resolved_model = model.strip() or (preset.default_model if preset is not None else "")
    if not resolved_model or len(resolved_model) > MAX_MODEL:
        raise ProviderError(codes.MODEL_MISSING)

    raw_scheme = auth_scheme.strip() or (
        preset.auth_scheme.value if preset is not None else AuthScheme.BEARER.value
    )
    try:
        resolved_scheme = AuthScheme(raw_scheme)
    except ValueError as error:
        raise ProviderError(codes.INVALID_HEADER) from error

    resolved_header = auth_header.strip() or (preset.auth_header if preset is not None else "")
    if resolved_scheme is AuthScheme.HEADER and not _HEADER_NAME_PATTERN.fullmatch(resolved_header):
        raise ProviderError(codes.INVALID_HEADER)

    return ProviderConfig(
        provider_id=resolved_id,
        name=resolved_name,
        kind=resolved_kind,
        base_url=normalise_base_url(resolved_url),
        model=resolved_model,
        preset_id=preset.preset_id if preset is not None else "",
        auth_scheme=resolved_scheme,
        auth_header=resolved_header if resolved_scheme is AuthScheme.HEADER else "",
        extra_headers=_clean_headers(extra_headers or {}),
        timeout_s=min(max(timeout_s, MIN_TIMEOUT_S), MAX_TIMEOUT_S),
    )
