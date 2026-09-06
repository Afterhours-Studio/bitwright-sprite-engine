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

"""Tests for provider configuration, credential storage, and the connection test.

No test here opens a socket. Every request goes through a mounted transport, so
a failure is a failure of this code and never of somebody's network, and no
made up key is ever sent to a real host.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from bitwright_engine.api.state import EngineState
from bitwright_engine.backends.remote import RemoteBackend
from bitwright_engine.config import Settings
from bitwright_engine.providers import codes
from bitwright_engine.providers.catalogue import PRESETS, AuthScheme, ProviderKind
from bitwright_engine.providers.credentials import FileStore, SecretError
from bitwright_engine.providers.probe import MODELS_PATH, probe
from bitwright_engine.providers.records import (
    MAX_PROVIDERS,
    ProviderError,
    build_provider,
    join_url,
    mask_key,
    normalise_base_url,
)
from bitwright_engine.providers.store import PROVIDERS_FILE, ProviderStore
from tests.conftest import mock_http_client

SECRET = "sk-live-0123456789abcdefwxyz"
"""A key used throughout, so a leak into a response body or a log is obvious."""

SECRET_BODY = SECRET[:-4]
"""Everything but the last four characters.

The masked hint deliberately shows the final four, so those are the one part of
the key that is allowed to appear. Nothing else ever may, and that is what the
leak tests assert.
"""

MODEL_LISTING = {"object": "list", "data": [{"id": "flux-schnell"}, {"id": "sdxl"}]}


def custom_body(**overrides: object) -> dict[str, object]:
    """Return a save body for a custom provider, with fields overridden.

    Args:
        overrides: Fields to replace.

    Returns:
        The request body.
    """
    body: dict[str, object] = {
        "name": "My router",
        "kind": "custom",
        "baseUrl": "https://router.example/api/v1",
        "model": "flux-schnell",
        "apiKey": SECRET,
    }
    body.update(overrides)
    return body


def answering(status: int, payload: object) -> httpx.Client:
    """Return a client whose transport answers every request the same way.

    Args:
        status: Status code to answer with.
        payload: JSON body to answer with.

    Returns:
        A client that never opens a socket.
    """
    return mock_http_client(lambda _request: httpx.Response(status, json=payload))


def failing(error: Exception) -> httpx.Client:
    """Return a client whose transport raises instead of answering.

    Args:
        error: The exception to raise for every request.

    Returns:
        A client that never opens a socket.
    """

    def handler(_request: httpx.Request) -> httpx.Response:
        raise error

    return mock_http_client(handler)


# --------------------------------------------------------------------------
# URL handling
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://api.example.com/v1", "https://api.example.com/v1"),
        ("https://api.example.com/v1/", "https://api.example.com/v1"),
        ("https://api.example.com/v1///", "https://api.example.com/v1"),
        ("  https://api.example.com/v1/  ", "https://api.example.com/v1"),
        ("https://api.example.com", "https://api.example.com"),
        ("https://api.example.com/", "https://api.example.com"),
        # A path prefix is kept. DeepInfra's compatible surface lives under one,
        # and truncating it would aim every request at the wrong place.
        ("https://api.deepinfra.com/v1/openai/", "https://api.deepinfra.com/v1/openai"),
        ("http://localhost:11434/v1/", "http://localhost:11434/v1"),
        ("http://127.0.0.1:8080/", "http://127.0.0.1:8080"),
    ],
)
def test_base_urls_are_normalised(raw: str, expected: str) -> None:
    assert normalise_base_url(raw) == expected


@pytest.mark.parametrize(
    ("base", "path", "expected"),
    [
        ("https://api.example.com/v1", "models", "https://api.example.com/v1/models"),
        ("https://api.example.com/v1/", "models", "https://api.example.com/v1/models"),
        ("https://api.example.com/v1", "/models", "https://api.example.com/v1/models"),
        ("https://api.example.com/v1/", "/models", "https://api.example.com/v1/models"),
        (
            "https://api.deepinfra.com/v1/openai",
            "models",
            "https://api.deepinfra.com/v1/openai/models",
        ),
    ],
)
def test_joining_never_doubles_a_slash(base: str, path: str, expected: str) -> None:
    joined = join_url(base, path)
    assert joined == expected
    # The scheme's own "//" is the only doubled slash allowed anywhere.
    assert "//" not in joined.removeprefix("https://").removeprefix("http://")


@pytest.mark.parametrize(
    "raw",
    ["", "   ", "example.com/v1", "ftp://example.com", "https://", "https://x.example/v1?a=1"],
)
def test_an_unusable_base_url_is_refused(raw: str) -> None:
    with pytest.raises(ProviderError) as caught:
        normalise_base_url(raw)
    assert caught.value.code == codes.INVALID_BASE_URL


def test_cleartext_http_is_refused_for_a_remote_host() -> None:
    # The key rides in a request header. Over plain http to a remote host that
    # is a credential handed to every device on the path.
    with pytest.raises(ProviderError) as caught:
        normalise_base_url("http://api.example.com/v1")
    assert caught.value.code == codes.INSECURE_URL


def test_cleartext_http_is_allowed_for_this_machine() -> None:
    # A router on this machine has nothing between it and the caller.
    assert normalise_base_url("http://localhost:1234") == "http://localhost:1234"
    assert normalise_base_url("http://127.0.0.5:1234") == "http://127.0.0.5:1234"


# --------------------------------------------------------------------------
# Records and validation
# --------------------------------------------------------------------------


def test_a_preset_fills_in_what_the_caller_left_blank() -> None:
    config = build_provider(provider_id="", name="", kind="preset", preset_id="openai")
    assert config.kind is ProviderKind.PRESET
    assert config.name == "OpenAI"
    assert config.base_url == "https://api.openai.com/v1"
    assert config.model == "gpt-image-1"
    assert config.auth_scheme is AuthScheme.BEARER


def test_a_preset_may_be_renamed_and_repointed() -> None:
    config = build_provider(
        provider_id="",
        name="Work account",
        kind="preset",
        preset_id="openai",
        base_url="https://proxy.internal.example/openai/v1",
        model="my-image-model",
    )
    assert config.preset_id == "openai"
    assert config.name == "Work account"
    assert config.base_url == "https://proxy.internal.example/openai/v1"


def test_an_unknown_preset_is_refused() -> None:
    with pytest.raises(ProviderError) as caught:
        build_provider(provider_id="", name="x", kind="preset", preset_id="nope")
    assert caught.value.code == codes.UNKNOWN_PRESET


def test_a_provider_without_a_model_is_refused() -> None:
    with pytest.raises(ProviderError) as caught:
        build_provider(
            provider_id="",
            name="Router",
            kind="custom",
            base_url="https://router.example/v1",
        )
    assert caught.value.code == codes.MODEL_MISSING


def test_a_header_that_would_be_injection_is_refused() -> None:
    # A newline in a header value ends the field early and lets the rest be
    # read as further headers.
    with pytest.raises(ProviderError) as caught:
        build_provider(
            provider_id="",
            name="Router",
            kind="custom",
            base_url="https://router.example/v1",
            model="m",
            extra_headers={"X-Title": "a\r\nAuthorization: Bearer stolen"},
        )
    assert caught.value.code == codes.INVALID_HEADER


def test_headers_carry_the_credential_the_way_the_provider_expects() -> None:
    bearer = build_provider(
        provider_id="",
        name="R",
        kind="custom",
        base_url="https://r.example/v1",
        model="m",
    )
    assert bearer.headers(SECRET)["Authorization"] == f"Bearer {SECRET}"

    named = build_provider(
        provider_id="",
        name="R",
        kind="custom",
        base_url="https://r.example/v1",
        model="m",
        auth_scheme="header",
        auth_header="x-api-key",
    )
    assert named.headers(SECRET)["x-api-key"] == SECRET
    assert "Authorization" not in named.headers(SECRET)

    anonymous = build_provider(
        provider_id="",
        name="R",
        kind="custom",
        base_url="http://localhost:1234/v1",
        model="m",
        auth_scheme="none",
    )
    assert anonymous.headers("") == {"Accept": "application/json"}
    assert not anonymous.needs_key


def test_an_extra_header_cannot_displace_the_credential() -> None:
    config = build_provider(
        provider_id="",
        name="R",
        kind="custom",
        base_url="https://r.example/v1",
        model="m",
        extra_headers={"Authorization": "Bearer attacker"},
    )
    assert config.headers(SECRET)["Authorization"] == f"Bearer {SECRET}"


@pytest.mark.parametrize(
    ("key", "expected"),
    [("", ""), ("short", "*****"), ("12345678", "********"), ("sk-abcdefghij", "****ghij")],
)
def test_a_key_is_masked_down_to_a_hint(key: str, expected: str) -> None:
    masked = mask_key(key)
    assert masked == expected
    # Never enough of the key to be worth having.
    assert len(masked.strip("*")) <= 4


def test_a_record_carries_no_credential_into_its_serialised_form() -> None:
    config = build_provider(
        provider_id="",
        name="R",
        kind="custom",
        base_url="https://r.example/v1",
        model="m",
    )
    assert SECRET not in json.dumps(config.to_json())
    assert "apiKey" not in config.to_json()


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------


def test_a_provider_round_trips_through_the_store(provider_store: ProviderStore) -> None:
    config = build_provider(
        provider_id="",
        name="My router",
        kind="custom",
        base_url="https://router.example/api/v1/",
        model="flux-schnell",
        extra_headers={"X-Title": "Bitwright"},
        timeout_s=45.0,
    )
    provider_store.save(config, SECRET)

    reloaded = ProviderStore(provider_store.directory, FileStore(provider_store.directory))
    stored = reloaded.require(config.provider_id)

    assert stored.name == "My router"
    assert stored.base_url == "https://router.example/api/v1"
    assert stored.model == "flux-schnell"
    assert stored.extra_headers == {"X-Title": "Bitwright"}
    assert stored.timeout_s == 45.0
    assert reloaded.api_key(config.provider_id) == SECRET
    assert reloaded.active_id == config.provider_id


def test_the_records_file_never_holds_a_credential(provider_store: ProviderStore) -> None:
    config = build_provider(
        provider_id="",
        name="R",
        kind="custom",
        base_url="https://r.example/v1",
        model="m",
    )
    provider_store.save(config, SECRET)
    assert SECRET not in (provider_store.directory / PROVIDERS_FILE).read_text(encoding="utf-8")


def test_the_first_provider_added_becomes_the_active_one(provider_store: ProviderStore) -> None:
    first = build_provider(
        provider_id="", name="One", kind="custom", base_url="https://a.example/v1", model="m"
    )
    second = build_provider(
        provider_id="", name="Two", kind="custom", base_url="https://b.example/v1", model="m"
    )
    provider_store.save(first, SECRET)
    provider_store.save(second, SECRET)

    assert provider_store.active_id == first.provider_id

    provider_store.activate(second.provider_id)
    active = provider_store.active()
    assert active is not None
    assert active.name == "Two"


def test_removing_the_active_provider_moves_the_selection(provider_store: ProviderStore) -> None:
    first = build_provider(
        provider_id="", name="One", kind="custom", base_url="https://a.example/v1", model="m"
    )
    second = build_provider(
        provider_id="", name="Two", kind="custom", base_url="https://b.example/v1", model="m"
    )
    provider_store.save(first, SECRET)
    provider_store.save(second, SECRET)
    provider_store.activate(second.provider_id)

    provider_store.remove(second.provider_id)
    assert provider_store.active_id == first.provider_id
    assert provider_store.api_key(second.provider_id) == ""


def test_saving_without_a_key_leaves_the_stored_one_alone(provider_store: ProviderStore) -> None:
    config = build_provider(
        provider_id="", name="R", kind="custom", base_url="https://r.example/v1", model="m"
    )
    provider_store.save(config, SECRET)

    renamed = build_provider(
        provider_id=config.provider_id,
        name="Renamed",
        kind="custom",
        base_url="https://r.example/v1",
        model="m",
    )
    provider_store.save(renamed, None)

    assert provider_store.require(config.provider_id).name == "Renamed"
    assert provider_store.api_key(config.provider_id) == SECRET


def test_saving_an_empty_key_clears_it(provider_store: ProviderStore) -> None:
    config = build_provider(
        provider_id="", name="R", kind="custom", base_url="https://r.example/v1", model="m"
    )
    provider_store.save(config, SECRET)
    provider_store.save(config, "")
    assert provider_store.api_key(config.provider_id) == ""
    assert not provider_store.has_key(config.provider_id)


def test_the_provider_limit_is_enforced(provider_store: ProviderStore) -> None:
    for index in range(MAX_PROVIDERS):
        provider_store.save(
            build_provider(
                provider_id="",
                name=f"R{index}",
                kind="custom",
                base_url=f"https://r{index}.example/v1",
                model="m",
            ),
            SECRET,
        )

    with pytest.raises(ProviderError) as caught:
        provider_store.save(
            build_provider(
                provider_id="",
                name="One too many",
                kind="custom",
                base_url="https://extra.example/v1",
                model="m",
            ),
            SECRET,
        )
    assert caught.value.code == codes.LIMIT_REACHED


def test_one_unusable_entry_does_not_discard_the_rest(tmp_path: Path) -> None:
    # The file is on a disk the user can edit. Being locked out of the settings
    # screen by a stray field is worse than losing one row.
    directory = tmp_path / "hand-edited"
    directory.mkdir()
    (directory / PROVIDERS_FILE).write_text(
        json.dumps(
            {
                "version": 1,
                "activeId": "pgood",
                "providers": [
                    {"id": "pbroken", "name": "Broken", "kind": "custom", "baseUrl": "nonsense"},
                    {
                        "id": "pgood",
                        "name": "Good",
                        "kind": "custom",
                        "baseUrl": "https://good.example/v1",
                        "model": "m",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    store = ProviderStore(directory, FileStore(directory))
    assert [config.name for config in store.all()] == ["Good"]
    assert store.active_id == "pgood"


def test_an_unreadable_records_file_is_not_fatal(tmp_path: Path) -> None:
    directory = tmp_path / "corrupt"
    directory.mkdir()
    (directory / PROVIDERS_FILE).write_text("{not json", encoding="utf-8")

    store = ProviderStore(directory, FileStore(directory))
    assert store.all() == []
    assert store.active_id == ""


def test_the_file_credential_store_round_trips(tmp_path: Path) -> None:
    store = FileStore(tmp_path)
    assert store.read("pabc") == ""

    store.write("pabc", SECRET)
    assert store.read("pabc") == SECRET

    # Deleting something that is not there must not fail, so that removing a
    # provider whose key was already gone still works.
    store.remove("pmissing")
    store.remove("pabc")
    assert store.read("pabc") == ""


def test_the_file_credential_store_reports_a_broken_file(tmp_path: Path) -> None:
    store = FileStore(tmp_path)
    store.path.write_text("{not json", encoding="utf-8")
    with pytest.raises(SecretError) as caught:
        store.read("pabc")
    assert caught.value.code == codes.SECRET_READ_FAILED


# --------------------------------------------------------------------------
# The connection test
# --------------------------------------------------------------------------


def a_provider() -> object:
    """Return a provider record used by the probe tests.

    Returns:
        A custom provider pointing at a host nothing resolves.
    """
    return build_provider(
        provider_id="",
        name="Router",
        kind="custom",
        base_url="https://router.example/api/v1/",
        model="flux-schnell",
    )


def test_the_probe_asks_for_the_model_listing_at_the_joined_url() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=MODEL_LISTING)

    config = build_provider(
        provider_id="",
        name="DeepInfra",
        kind="preset",
        preset_id="deepinfra",
    )
    with mock_http_client(handler) as client:
        result = probe(config, SECRET, client=client)

    assert result.ok
    assert result.code == codes.REACHABLE
    assert result.model_count == 2
    assert str(seen[0].url) == f"https://api.deepinfra.com/v1/openai/{MODELS_PATH}"
    assert seen[0].headers["authorization"] == f"Bearer {SECRET}"


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, codes.BAD_KEY),
        (403, codes.FORBIDDEN),
        (404, codes.NOT_FOUND),
        (302, codes.NOT_FOUND),
        (429, codes.RATE_LIMITED),
        (500, codes.SERVER_ERROR),
        (503, codes.SERVER_ERROR),
        (418, codes.REQUEST_FAILED),
    ],
)
def test_the_probe_maps_each_status_onto_its_own_code(status: int, expected: str) -> None:
    with answering(status, {"error": "no"}) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert not result.ok
    assert result.code == expected


def test_the_probe_reports_an_unreachable_host() -> None:
    with failing(httpx.ConnectError("getaddrinfo failed")) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.code == codes.UNREACHABLE


def test_the_probe_tells_a_refusal_apart_from_an_unreachable_host() -> None:
    # A refusal means something is at that address and declined to talk, which
    # is a wrong port rather than a wrong host name.
    refused = httpx.ConnectError("refused")
    refused.__cause__ = ConnectionRefusedError(61, "Connection refused")
    with failing(refused) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.code == codes.REFUSED


def test_the_probe_reports_a_timeout() -> None:
    with failing(httpx.ReadTimeout("too slow")) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.code == codes.TIMEOUT


@pytest.mark.parametrize("payload", [{"models": ["a"]}, {"data": "not a list"}, "plain text", 7])
def test_the_probe_reports_an_answer_that_is_not_a_model_listing(payload: object) -> None:
    with answering(200, payload) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.code == codes.UNEXPECTED_SHAPE


def test_an_empty_model_listing_still_counts_as_reachable() -> None:
    # The endpoint spoke the protocol, which is what the test asked.
    with answering(200, {"object": "list", "data": []}) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.ok
    assert result.model_count == 0


def test_the_probe_never_returns_the_key_even_when_the_provider_echoes_it() -> None:
    # Some providers put the offending credential into their error message.
    body = {"error": {"message": f"Incorrect API key provided: {SECRET}"}}
    with answering(401, body) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.code == codes.BAD_KEY
    assert SECRET not in result.detail
    assert SECRET_BODY not in result.detail


def test_the_probe_does_not_follow_a_redirect() -> None:
    # Following one would carry the credential to whatever host the provider
    # named, which is not a host the user configured.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://elsewhere.example/v1/models"})

    with mock_http_client(handler) as client:
        result = probe(a_provider(), SECRET, client=client)  # type: ignore[arg-type]
    assert result.code == codes.NOT_FOUND


# --------------------------------------------------------------------------
# The HTTP routes
# --------------------------------------------------------------------------


def test_the_listing_offers_every_preset(client: TestClient) -> None:
    body = client.get("/v1/providers").json()
    assert [preset["presetId"] for preset in body["presets"]] == [
        preset.preset_id for preset in PRESETS
    ]
    assert body["providers"] == []
    assert body["activeId"] == ""
    assert body["secretStorage"] in {"keychain", "file"}
    assert body["maxProviders"] == MAX_PROVIDERS


def test_a_provider_round_trips_through_the_api(client: TestClient) -> None:
    created = client.post("/v1/providers/save", json=custom_body())
    assert created.status_code == 200

    entry = created.json()["providers"][0]
    assert entry["name"] == "My router"
    assert entry["baseUrl"] == "https://router.example/api/v1"
    assert entry["model"] == "flux-schnell"
    assert entry["active"] is True
    assert entry["hasKey"] is True
    assert entry["keyHint"] == f"****{SECRET[-4:]}"

    listed = client.get("/v1/providers").json()["providers"][0]
    assert listed == entry


def test_no_response_ever_carries_the_key(client: TestClient, app_providers: ProviderStore) -> None:
    saved = client.post("/v1/providers/save", json=custom_body())
    provider_id = saved.json()["providers"][0]["providerId"]

    bodies = [
        saved.text,
        client.get("/v1/providers").text,
        client.post(f"/v1/providers/{provider_id}/activate").text,
        client.post(f"/v1/providers/{provider_id}/test").text,
        client.get("/v1/backends").text,
        client.post(f"/v1/providers/{provider_id}/remove").text,
    ]
    for body in bodies:
        assert SECRET not in body
        # Not even most of it. Only the four characters the mask shows.
        assert SECRET_BODY not in body

    # The key really was stored. The point is that it never came back out.
    assert app_providers.get(provider_id) is None


def test_nothing_on_the_provider_path_writes_the_key_to_a_log(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG):
        saved = client.post("/v1/providers/save", json=custom_body())
        provider_id = saved.json()["providers"][0]["providerId"]
        client.get("/v1/providers")
        client.post(f"/v1/providers/{provider_id}/test")
        client.post(f"/v1/providers/{provider_id}/remove")

    written = "\n".join(record.getMessage() for record in caplog.records)
    assert SECRET not in written
    assert "TAIL" not in written


def test_saving_over_a_provider_without_a_key_keeps_the_stored_one(
    client: TestClient,
    app_providers: ProviderStore,
) -> None:
    # This is what a settings form sends when the user edited the name and
    # never opened the key field. It must not be able to destroy the key.
    saved = client.post("/v1/providers/save", json=custom_body())
    provider_id = saved.json()["providers"][0]["providerId"]

    body = custom_body(providerId=provider_id, name="Renamed")
    del body["apiKey"]
    updated = client.post("/v1/providers/save", json=body)

    assert updated.json()["providers"][0]["name"] == "Renamed"
    assert updated.json()["providers"][0]["hasKey"] is True
    assert app_providers.api_key(provider_id) == SECRET


def test_selecting_the_active_provider(client: TestClient) -> None:
    first = client.post("/v1/providers/save", json=custom_body(name="One")).json()
    second = client.post(
        "/v1/providers/save",
        json=custom_body(name="Two", baseUrl="https://two.example/v1"),
    ).json()

    first_id = first["providers"][0]["providerId"]
    second_id = second["providers"][1]["providerId"]
    assert second["activeId"] == first_id

    switched = client.post(f"/v1/providers/{second_id}/activate").json()
    assert switched["activeId"] == second_id
    assert [entry["active"] for entry in switched["providers"]] == [False, True]


def test_a_saved_provider_makes_the_remote_backend_available(client: TestClient) -> None:
    # The test settings carry an environment endpoint, so the remote backend
    # starts out usable through that path. Saving a provider takes over.
    before = client.get("/v1/backends").json()["backends"]
    remote = next(entry for entry in before if entry["kind"] == "remote")
    assert "example.invalid" in remote["device"]

    client.post("/v1/providers/save", json=custom_body())

    after = client.get("/v1/backends").json()["backends"]
    remote = next(entry for entry in after if entry["kind"] == "remote")
    assert remote["available"] is True
    assert remote["device"] == "My router (https://router.example/api/v1)"


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (custom_body(baseUrl="not a url"), codes.INVALID_BASE_URL),
        (custom_body(baseUrl="http://api.example.com/v1"), codes.INSECURE_URL),
        (custom_body(model=""), codes.MODEL_MISSING),
        (custom_body(kind="preset", presetId="nope"), codes.UNKNOWN_PRESET),
        (custom_body(name="   "), codes.NAME_MISSING),
    ],
)
def test_an_unusable_provider_is_refused_with_its_own_code(
    client: TestClient,
    body: dict[str, object],
    expected: str,
) -> None:
    response = client.post("/v1/providers/save", json=body)
    assert response.status_code == 422
    assert response.json()["detail"] == expected


@pytest.mark.parametrize("path", ["activate", "remove", "test"])
def test_acting_on_an_unknown_provider_is_a_404(client: TestClient, path: str) -> None:
    response = client.post(f"/v1/providers/pmissing/{path}")
    assert response.status_code == 404
    assert response.json()["detail"] == codes.PROVIDER_UNKNOWN


def test_a_provider_id_that_is_not_an_identifier_is_refused(client: TestClient) -> None:
    response = client.post("/v1/providers/..%2Fbackends/activate")
    assert response.status_code == 404


def test_removing_a_provider_deletes_its_credential(
    client: TestClient,
    app_providers: ProviderStore,
) -> None:
    saved = client.post("/v1/providers/save", json=custom_body())
    provider_id = saved.json()["providers"][0]["providerId"]
    assert app_providers.api_key(provider_id) == SECRET

    removed = client.post(f"/v1/providers/{provider_id}/remove")
    assert removed.status_code == 200
    assert removed.json()["providers"] == []
    assert app_providers.api_key(provider_id) == ""


def test_the_connection_test_route_reports_success(
    client: TestClient,
    engine_state: EngineState,
) -> None:
    saved = client.post("/v1/providers/save", json=custom_body())
    provider_id = saved.json()["providers"][0]["providerId"]

    with answering(200, MODEL_LISTING) as transport:
        engine_state.probe_client = transport
        body = client.post(f"/v1/providers/{provider_id}/test").json()

    assert body["ok"] is True
    assert body["code"] == codes.REACHABLE
    assert body["modelCount"] == 2


def test_the_connection_test_route_reports_a_rejected_key(
    client: TestClient,
    engine_state: EngineState,
) -> None:
    # A refused key answers 200 here. It is the result the user pressed the
    # button to find out, not a fault in this API.
    saved = client.post("/v1/providers/save", json=custom_body())
    provider_id = saved.json()["providers"][0]["providerId"]

    with answering(401, {"error": "bad key"}) as transport:
        engine_state.probe_client = transport
        response = client.post(f"/v1/providers/{provider_id}/test")

    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["code"] == codes.BAD_KEY


def test_the_connection_test_route_reports_a_missing_key(client: TestClient) -> None:
    body = custom_body()
    body["apiKey"] = ""
    saved = client.post("/v1/providers/save", json=body)
    provider_id = saved.json()["providers"][0]["providerId"]

    result = client.post(f"/v1/providers/{provider_id}/test").json()
    assert result["ok"] is False
    assert result["code"] == codes.API_KEY_MISSING


# --------------------------------------------------------------------------
# The remote backend
# --------------------------------------------------------------------------


def test_the_backend_prefers_a_configured_provider_over_the_environment(
    provider_store: ProviderStore,
) -> None:
    settings = Settings(remote_endpoint="https://from-env.example", remote_api_key="env-key")
    backend = RemoteBackend(settings, provider_store)
    assert "from-env.example" in backend.available().device

    provider_store.save(
        build_provider(
            provider_id="",
            name="Chosen",
            kind="custom",
            base_url="https://chosen.example/v1",
            model="m",
        ),
        SECRET,
    )
    assert backend.available().device == "Chosen (https://chosen.example/v1)"


def test_the_backend_reports_a_provider_with_no_credential(
    provider_store: ProviderStore,
) -> None:
    config = build_provider(
        provider_id="", name="R", kind="custom", base_url="https://r.example/v1", model="m"
    )
    provider_store.save(config, "")
    backend = RemoteBackend(Settings(remote_endpoint="", remote_api_key=""), provider_store)
    assert backend.available().detail == codes.API_KEY_MISSING


def test_the_backend_reports_that_no_provider_is_selected(
    provider_store: ProviderStore,
) -> None:
    config = build_provider(
        provider_id="", name="R", kind="custom", base_url="https://r.example/v1", model="m"
    )
    provider_store.save(config, SECRET)
    provider_store.remove(config.provider_id)

    settings = Settings(remote_endpoint="", remote_api_key="")
    assert RemoteBackend(settings, provider_store).available().detail == codes.ENDPOINT_MISSING


def test_a_provider_needing_no_credential_is_ready(provider_store: ProviderStore) -> None:
    provider_store.save(
        build_provider(
            provider_id="",
            name="Local router",
            kind="custom",
            base_url="http://localhost:11434/v1",
            model="m",
            auth_scheme="none",
        ),
        "",
    )
    backend = RemoteBackend(Settings(remote_endpoint="", remote_api_key=""), provider_store)
    assert backend.available().ready


# --------------------------------------------------------------------------
# Reason codes and their translations
# --------------------------------------------------------------------------

LOCALES = Path(__file__).resolve().parents[3] / "apps" / "desktop" / "src" / "locales"


def translated_codes(language: str) -> set[str]:
    """Return every ``backend.remote.*`` key present in one locale file.

    Args:
        language: Locale directory name.

    Returns:
        The dotted keys, prefixed as the engine emits them.
    """
    raw = json.loads((LOCALES / language / "errors.json").read_text(encoding="utf-8"))
    remote = raw["backend"]["remote"]
    return {f"{codes.PREFIX}{key}" for key in remote}


@pytest.mark.skipif(not LOCALES.is_dir(), reason="the desktop application is not in this checkout")
@pytest.mark.parametrize("language", ["en", "vi"])
def test_every_reason_code_has_a_translation(language: str) -> None:
    # A code with no entry shows the generic "something went wrong" message,
    # which tells the user nothing about what to fix. This is the check that
    # keeps adding a code and forgetting the two locale files from shipping.
    assert translated_codes(language) >= codes.ALL_CODES


def test_no_translation_is_left_behind_by_a_removed_code() -> None:
    for language in ("en", "vi"):
        assert translated_codes(language) <= codes.ALL_CODES
