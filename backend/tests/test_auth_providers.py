from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.auth import providers
from app.auth.providers import (
    PROVIDERS,
    ProviderError,
    code_challenge,
    discord_identity,
    fetch_identity,
    github_identity,
    google_identity,
)
from app.config import settings


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "api_public_url", "https://api.example.test/")
    for name in ("google", "discord", "github"):
        monkeypatch.setattr(settings, f"{name}_client_id", f"{name}-id")
        monkeypatch.setattr(settings, f"{name}_client_secret", f"{name}-secret")


def test_the_pkce_challenge_follows_rfc_7636() -> None:
    # RFC 7636, Appendix B.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert code_challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_a_code_verifier_has_a_valid_length() -> None:
    assert 43 <= len(providers.new_code_verifier()) <= 128


def test_a_provider_without_credentials_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "github_client_secret", "")
    assert PROVIDERS["google"].enabled
    assert not PROVIDERS["github"].enabled


def test_the_callback_is_on_the_api_host() -> None:
    assert PROVIDERS["discord"].callback_url() == "https://api.example.test/auth/discord/callback"


def test_the_authorization_url_carries_state_and_pkce() -> None:
    url = PROVIDERS["google"].authorization_url("the-state", "the-verifier")
    parts = urlsplit(url)
    query = {key: values[0] for key, values in parse_qs(parts.query).items()}
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == PROVIDERS["google"].authorize_url
    assert query == {
        "client_id": "google-id",
        "redirect_uri": "https://api.example.test/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": "the-state",
        "code_challenge": code_challenge("the-verifier"),
        "code_challenge_method": "S256",
    }


def test_a_provider_without_pkce_sends_no_challenge() -> None:
    query = parse_qs(urlsplit(PROVIDERS["discord"].authorization_url("s", "v")).query)
    assert "code_challenge" not in query


def test_google_profile() -> None:
    identity = google_identity(
        {"sub": "108", "email": "a@x.io", "email_verified": True, "name": " Ann ", "picture": "p"},
        [],
    )
    assert identity == providers.ProviderIdentity("108", "a@x.io", True, "Ann", "p")


def test_google_profile_with_nothing_but_an_id() -> None:
    identity = google_identity({"sub": 108, "email_verified": "true", "name": " "}, [])
    assert identity == providers.ProviderIdentity("108", None, False, None, None)


def test_discord_profile_prefers_the_display_name_and_builds_the_avatar() -> None:
    identity = discord_identity(
        {
            "id": "42",
            "username": "strahd",
            "global_name": "Strahd",
            "email": "s@x.io",
            "verified": True,
            "avatar": "abc",
        },
        [],
    )
    assert identity == providers.ProviderIdentity(
        "42", "s@x.io", True, "Strahd", "https://cdn.discordapp.com/avatars/42/abc.png"
    )


def test_discord_profile_without_display_name_or_avatar() -> None:
    identity = discord_identity({"id": "42", "username": "strahd", "avatar": None}, [])
    assert (identity.name, identity.picture, identity.email_verified) == ("strahd", None, False)


def test_github_profile_takes_the_primary_email() -> None:
    emails = [
        "junk",
        {"email": "other@x.io", "primary": False, "verified": True},
        {"email": "main@x.io", "primary": True, "verified": True},
    ]
    identity = github_identity(
        {"id": 7, "login": "vanrichten", "name": None, "avatar_url": "a", "email": "pub@x.io"},
        emails,
    )
    assert identity == providers.ProviderIdentity("7", "main@x.io", True, "vanrichten", "a")


def test_github_profile_without_emails_uses_the_public_one_unverified() -> None:
    identity = github_identity({"id": 7, "login": "v", "name": "Van", "email": "pub@x.io"}, [])
    assert (identity.email, identity.email_verified, identity.name) == ("pub@x.io", False, "Van")


Handler = Callable[[httpx.Request], httpx.Response]


def _mock(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        providers,
        "http_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(record)),
    )
    return seen


def _form(request: httpx.Request) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(request.content.decode()).items()}


async def test_google_code_is_traded_for_the_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "at"})
        assert request.headers["authorization"] == "Bearer at"
        return httpx.Response(200, json={"sub": "108", "email": "a@x.io", "email_verified": True})

    seen = _mock(monkeypatch, handler)
    identity = await fetch_identity(PROVIDERS["google"], "the-code", "the-verifier")
    assert identity.provider_user_id == "108"
    form = _form(seen[0])
    assert form == {
        "grant_type": "authorization_code",
        "code": "the-code",
        "redirect_uri": "https://api.example.test/auth/google/callback",
        "client_id": "google-id",
        "client_secret": "google-secret",
        "code_verifier": "the-verifier",
    }
    assert str(seen[1].url) == "https://openidconnect.googleapis.com/v1/userinfo"


async def test_github_also_reads_the_emails(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "at"})
        if request.url.path == "/user/emails":
            emails = [{"email": "m@x.io", "primary": True, "verified": True}]
            return httpx.Response(200, json=emails)
        return httpx.Response(200, json={"id": 7, "login": "v"})

    _mock(monkeypatch, handler)
    identity = await fetch_identity(PROVIDERS["github"], "c", "v")
    assert (identity.email, identity.email_verified) == ("m@x.io", True)


async def test_github_without_email_access_still_signs_in(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "at"})
        if request.url.path == "/user/emails":
            return httpx.Response(404, json={"message": "Not Found"})
        return httpx.Response(200, json={"id": 7, "login": "v"})

    _mock(monkeypatch, handler)
    identity = await fetch_identity(PROVIDERS["github"], "c", "v")
    assert identity.email is None


async def test_discord_sends_no_verifier(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "at"})
        return httpx.Response(200, json={"id": "42", "username": "s"})

    seen = _mock(monkeypatch, handler)
    await fetch_identity(PROVIDERS["discord"], "c", "v")
    assert "code_verifier" not in _form(seen[0])


@pytest.mark.parametrize(
    "responses",
    [
        [httpx.Response(400, json={"error": "invalid_grant"})],
        [httpx.Response(200, json={"error": "bad_verification_code"})],
        [httpx.Response(200, text="not json")],
        [httpx.Response(200, json={"access_token": "at"}), httpx.Response(401, json={})],
        [httpx.Response(200, json={"access_token": "at"}), httpx.Response(200, json=["x"])],
        [httpx.Response(200, json={"access_token": "at"}), httpx.Response(200, json={"x": 1})],
    ],
)
async def test_a_refusal_or_odd_answer_is_a_provider_error(
    monkeypatch: pytest.MonkeyPatch, responses: list[httpx.Response]
) -> None:
    queue: list[Any] = list(responses)
    _mock(monkeypatch, lambda request: queue.pop(0))
    with pytest.raises(ProviderError):
        await fetch_identity(PROVIDERS["google"], "c", "v")


async def test_a_network_failure_is_a_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    _mock(monkeypatch, handler)
    with pytest.raises(ProviderError):
        await fetch_identity(PROVIDERS["google"], "c", "v")


def test_the_real_http_client_has_a_timeout() -> None:
    client = providers.http_client()
    assert client.timeout.read == 15.0
