import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
import pytest_asyncio
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth as auth_api
from app.auth import providers, tokens
from app.auth.dependencies import CurrentUser, authenticated_user
from app.auth.providers import ProviderError, ProviderIdentity
from app.config import settings
from app.db import account_repo, users_repo
from app.db.models import AuthIdentityRow, AuthSessionRow, UserRow
from app.domain.sign_in import ROTATION_GRACE
from app.main import app

client = TestClient(app)

USER_ID = "11111111-1111-1111-1111-111111111111"
FRONTEND = "http://localhost:5173"

# --- Access tokens -----------------------------------------------------------


def test_me_without_token_is_unauthorized() -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_me_with_valid_token_resolves_user(make_token: Callable[..., str]) -> None:
    token = make_token(USER_ID, email="player@example.com")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"id": USER_ID, "email": "player@example.com"}


def test_a_token_issued_by_the_backend_is_accepted() -> None:
    token = tokens.issue_access_token(USER_ID, "p@x.io", "github", "Van", "https://a")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.json() == {"id": USER_ID, "email": "p@x.io"}


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": datetime.now(UTC) - timedelta(hours=1)},
        {"aud": "something-else"},
        {"aud": tokens.SIGN_IN_AUDIENCE},
        {"iss": "https://zyrgrmaxqkegnosapjbo.supabase.co/auth/v1"},
        {"sub": None},
    ],
)
def test_an_invalid_token_is_unauthorized(
    make_token: Callable[..., str], overrides: dict[str, object]
) -> None:
    token = make_token(USER_ID, **overrides)
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_a_token_without_a_subject_is_unauthorized() -> None:
    token = tokens.issue_sign_in_state({"state": "s"})
    claims = tokens.decode_sign_in_state(token)
    forged = jwt.encode(
        {**claims, "aud": tokens.ACCESS_AUDIENCE}, settings.auth_token_secret, algorithm="HS256"
    )
    with pytest.raises(tokens.InvalidTokenError):
        tokens.decode_access_token(forged)


def _user_from(token: str) -> CurrentUser:
    return authenticated_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), locale="en"
    )


def test_profile_defaults_come_from_the_token(make_token: Callable[..., str]) -> None:
    user = _user_from(make_token(USER_ID, name="Ireena", picture="https://p/i"))
    assert (user.google_name, user.google_picture_url) == ("Ireena", "https://p/i")


def test_blank_profile_claims_leave_the_defaults_unset(make_token: Callable[..., str]) -> None:
    user = _user_from(make_token(USER_ID, name=" ", picture=None))
    assert (user.email, user.google_name, user.google_picture_url) == (None, None, None)


def test_signing_needs_a_long_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "auth_token_secret", "short")
    with pytest.raises(tokens.MissingSecretError):
        tokens.require_secret()


def test_the_sign_in_state_round_trips() -> None:
    cookie = tokens.issue_sign_in_state({"state": "s", "return_to": FRONTEND})
    assert tokens.decode_sign_in_state(cookie)["state"] == "s"
    with pytest.raises(tokens.InvalidTokenError):
        tokens.decode_access_token(cookie)


# --- The sign-in flow ----------------------------------------------------------


@pytest.fixture(autouse=True)
def _providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "api_public_url", "https://api.test")
    monkeypatch.setattr(settings, "cors_origins", [FRONTEND])
    for name in ("google", "discord"):
        monkeypatch.setattr(settings, f"{name}_client_id", f"{name}-id")
        monkeypatch.setattr(settings, f"{name}_client_secret", f"{name}-secret")
    monkeypatch.setattr(settings, "github_client_id", "")


@pytest_asyncio.fixture
async def browser() -> AsyncIterator[AsyncClient]:
    """A browser on the API's host: HTTPS, so the Secure cookies come back."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://api.test") as ac:
        yield ac


def _identity(provider_user_id: str = "g-1", **changes: object) -> ProviderIdentity:
    values: dict[str, object] = {
        "provider_user_id": provider_user_id,
        "email": "ann@x.io",
        "email_verified": True,
        "name": "Ann",
        "picture": "https://p/ann",
    }
    values.update(changes)
    return ProviderIdentity(**values)  # type: ignore[arg-type]


def _provider_answers(monkeypatch: pytest.MonkeyPatch, answer: ProviderIdentity | None) -> None:
    async def fake_fetch(provider: object, code: str, verifier: str) -> ProviderIdentity:
        assert code == "the-code" and verifier
        if answer is None:
            raise ProviderError("refused")
        return answer

    monkeypatch.setattr(providers, "fetch_identity", fake_fetch)


async def _start(browser: AsyncClient, provider: str = "google") -> str:
    response = await browser.get(f"/auth/{provider}/start", params={"return_to": FRONTEND})
    assert response.status_code == 302
    location = response.headers["location"]
    return parse_qs(urlsplit(location).query)["state"][0]


async def _sign_in(
    browser: AsyncClient, monkeypatch: pytest.MonkeyPatch, identity: ProviderIdentity
) -> str:
    _provider_answers(monkeypatch, identity)
    state = await _start(browser)
    response = await browser.get(
        "/auth/google/callback", params={"code": "the-code", "state": state}
    )
    assert response.status_code == 302
    assert response.headers["location"] == f"{FRONTEND}/"
    return response.cookies[auth_api.SESSION_COOKIE]


async def _identity_of(db_session: AsyncSession, provider: str) -> AuthIdentityRow:
    stmt = select(AuthIdentityRow).where(AuthIdentityRow.provider == provider)
    return (await db_session.execute(stmt)).scalar_one()


async def test_start_sends_the_browser_to_the_provider(browser: AsyncClient) -> None:
    response = await browser.get("/auth/google/start", params={"return_to": FRONTEND + "/"})
    assert response.status_code == 302
    location = urlsplit(response.headers["location"])
    assert location.netloc == "accounts.google.com"
    query = parse_qs(location.query)
    assert query["redirect_uri"] == ["https://api.test/auth/google/callback"]
    cookie = response.headers["set-cookie"]
    assert auth_api.SIGN_IN_COOKIE in cookie
    for flag in ("HttpOnly", "Secure", "SameSite=lax", "Path=/auth"):
        assert flag in cookie
    claims = tokens.decode_sign_in_state(response.cookies[auth_api.SIGN_IN_COOKIE])
    assert claims["state"] == query["state"][0]
    assert claims["return_to"] == FRONTEND


@pytest.mark.parametrize("provider", ["github", "facebook"])
async def test_an_unavailable_provider_is_not_found(browser: AsyncClient, provider: str) -> None:
    response = await browser.get(f"/auth/{provider}/start", params={"return_to": FRONTEND})
    assert response.status_code == 404


@pytest.mark.parametrize("return_to", [None, "https://evil.example", FRONTEND + "/rooms"])
async def test_start_refuses_a_foreign_return_address(
    browser: AsyncClient, return_to: str | None
) -> None:
    params = {"return_to": return_to} if return_to else {}
    response = await browser.get("/auth/google/start", params=params)
    assert response.status_code == 400


async def test_a_first_sign_in_creates_the_user_and_a_session(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    cookie = await _sign_in(browser, monkeypatch, _identity())
    identity = (await db_session.execute(select(AuthIdentityRow))).scalar_one()
    assert (identity.provider, identity.provider_user_id, identity.name) == ("google", "g-1", "Ann")
    user = await db_session.get(UserRow, identity.user_id)
    assert user is not None and user.email == "ann@x.io"
    auth_session = (await db_session.execute(select(AuthSessionRow))).scalar_one()
    assert auth_session.token_hash == tokens.hash_refresh_token(cookie)
    assert auth_session.user_agent is not None
    assert auth_api.SIGN_IN_COOKIE not in browser.cookies


async def test_signing_in_again_reaches_the_same_user(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _sign_in(browser, monkeypatch, _identity())
    await _sign_in(browser, monkeypatch, _identity(name="Ann B", email="new@x.io"))
    rows = (await db_session.execute(select(AuthIdentityRow))).scalars().all()
    assert len(rows) == 1 and rows[0].email == "new@x.io" and rows[0].name == "Ann B"
    sessions = (await db_session.execute(select(AuthSessionRow))).scalars().all()
    assert len(sessions) == 2 and sessions[0].user_id == sessions[1].user_id


async def test_a_migrated_identity_keeps_its_user(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid.uuid4()
    db_session.add(
        AuthIdentityRow(provider="google", provider_user_id="g-1", user_id=user_id, email=None)
    )
    await db_session.flush()
    await _sign_in(browser, monkeypatch, _identity())
    auth_session = (await db_session.execute(select(AuthSessionRow))).scalar_one()
    assert auth_session.user_id == user_id


async def test_a_verified_email_links_another_provider(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid.uuid4()
    db_session.add(
        AuthIdentityRow(
            provider="discord",
            provider_user_id="d-1",
            user_id=user_id,
            email="ANN@x.io",
            email_verified=True,
        )
    )
    await db_session.flush()
    await _sign_in(browser, monkeypatch, _identity())
    google = await _identity_of(db_session, "google")
    assert google.user_id == user_id


async def test_the_users_mirror_email_never_links(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid.uuid4()
    await users_repo.upsert_user(db_session, user_id, "ann@x.io")
    await _sign_in(browser, monkeypatch, _identity())
    identity = (await db_session.execute(select(AuthIdentityRow))).scalar_one()
    assert identity.user_id != user_id


# Pre-hijacking: an unverified sign-in claiming someone's address must not
# become the account their verified sign-in later lands in.
async def test_an_unverified_sign_in_cannot_capture_a_later_verified_one(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _sign_in(browser, monkeypatch, _identity("attacker", email_verified=False))
    await _sign_in(browser, monkeypatch, _identity("victim"))
    rows = (await db_session.execute(select(AuthIdentityRow))).scalars().all()
    by_account = {row.provider_user_id: row.user_id for row in rows}
    assert by_account["attacker"] != by_account["victim"]
    attacker = await db_session.get(UserRow, by_account["attacker"])
    assert attacker is not None and attacker.email is None


async def test_an_unverified_email_never_links(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid.uuid4()
    await users_repo.upsert_user(db_session, user_id, "ann@x.io")
    await _sign_in(browser, monkeypatch, _identity(email_verified=False))
    identity = (await db_session.execute(select(AuthIdentityRow))).scalar_one()
    assert identity.user_id != user_id


async def test_an_unverified_identity_email_does_not_attract_others(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = uuid.uuid4()
    db_session.add(
        AuthIdentityRow(provider="discord", provider_user_id="d-1", user_id=other, email="ann@x.io")
    )
    await db_session.flush()
    await _sign_in(browser, monkeypatch, _identity())
    google = await _identity_of(db_session, "google")
    assert google.user_id != other


async def test_a_callback_without_the_cookie_is_refused(browser: AsyncClient) -> None:
    response = await browser.get("/auth/google/callback", params={"code": "c", "state": "s"})
    assert response.status_code == 400


async def test_a_cookie_with_a_foreign_return_address_is_refused(browser: AsyncClient) -> None:
    cookie = tokens.issue_sign_in_state(
        {"state": "s", "verifier": "v", "provider": "google", "return_to": "https://evil.example"}
    )
    browser.cookies.set(auth_api.SIGN_IN_COOKIE, cookie, domain="api.test", path="/auth")
    response = await browser.get("/auth/google/callback", params={"code": "c", "state": "s"})
    assert response.status_code == 400


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/auth/google/callback", {"code": "the-code", "state": "wrong"}),
        ("/auth/google/callback", {"state": "RIGHT"}),
        ("/auth/google/callback", {"code": "the-code"}),
        ("/auth/google/callback", {"error": "access_denied", "state": "RIGHT"}),
        ("/auth/discord/callback", {"code": "the-code", "state": "RIGHT"}),
        ("/auth/facebook/callback", {"code": "the-code", "state": "RIGHT"}),
    ],
)
async def test_a_mismatched_callback_goes_back_with_an_error(
    browser: AsyncClient, monkeypatch: pytest.MonkeyPatch, path: str, params: dict[str, str]
) -> None:
    _provider_answers(monkeypatch, _identity())
    state = await _start(browser)
    query = {key: (state if value == "RIGHT" else value) for key, value in params.items()}
    response = await browser.get(path, params=query)
    assert response.status_code == 302
    assert response.headers["location"] == f"{FRONTEND}/?signInError=1"
    assert auth_api.SESSION_COOKIE not in response.cookies


async def test_a_provider_refusal_goes_back_with_an_error(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _provider_answers(monkeypatch, None)
    state = await _start(browser)
    response = await browser.get(
        "/auth/google/callback", params={"code": "the-code", "state": state}
    )
    assert response.headers["location"] == f"{FRONTEND}/?signInError=1"
    assert (await db_session.execute(select(AuthSessionRow))).first() is None


async def test_sign_in_is_rate_limited_per_address(browser: AsyncClient) -> None:
    headers = {"X-Forwarded-For": "203.0.113.9"}
    for _ in range(auth_api.SIGN_IN_THROTTLE.limit):
        await browser.get("/auth/google/start", params={"return_to": FRONTEND}, headers=headers)
    refused = await browser.get(
        "/auth/google/start", params={"return_to": FRONTEND}, headers=headers
    )
    assert refused.status_code == 429
    other = await browser.get(
        "/auth/google/start",
        params={"return_to": FRONTEND},
        headers={"X-Forwarded-For": "203.0.113.10"},
    )
    assert other.status_code == 302


# --- Refresh and sign-out -----------------------------------------------------


async def test_refresh_rotates_the_token_and_issues_an_access_token(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = await _sign_in(browser, monkeypatch, _identity())
    response = await browser.post("/auth/refresh", headers={"Origin": FRONTEND})
    assert response.status_code == 200
    body = response.json()
    claims = tokens.decode_access_token(body["access_token"])
    assert (claims["email"], claims["name"], claims["picture"]) == (
        "ann@x.io",
        "Ann",
        "https://p/ann",
    )
    assert body["expires_in"] == 900
    assert body["user"] == {"id": claims["sub"], "email": "ann@x.io", "provider": "google"}
    second = response.cookies[auth_api.SESSION_COOKIE]
    assert second != first
    row = (await db_session.execute(select(AuthSessionRow))).scalar_one()
    assert (row.token_hash, row.previous_token_hash) == (
        tokens.hash_refresh_token(second),
        tokens.hash_refresh_token(first),
    )


async def test_the_previous_token_works_during_the_grace(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = await _sign_in(browser, monkeypatch, _identity())
    await browser.post("/auth/refresh")
    browser.cookies.set(auth_api.SESSION_COOKIE, first, domain="api.test", path="/auth")
    response = await browser.post("/auth/refresh")
    assert response.status_code == 200
    assert "set-cookie" not in response.headers


async def test_an_old_token_after_the_grace_signs_the_session_out(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = await _sign_in(browser, monkeypatch, _identity())
    await browser.post("/auth/refresh")
    long_ago = datetime.now(UTC) - ROTATION_GRACE - timedelta(seconds=5)
    await db_session.execute(update(AuthSessionRow).values(rotated_at=long_ago))
    browser.cookies.set(auth_api.SESSION_COOKIE, first, domain="api.test", path="/auth")
    assert (await browser.post("/auth/refresh")).status_code == 401
    row = (await db_session.execute(select(AuthSessionRow))).scalar_one()
    await db_session.refresh(row)
    assert row.revoked_at is not None


async def test_an_expired_session_does_not_refresh(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _sign_in(browser, monkeypatch, _identity())
    await db_session.execute(
        update(AuthSessionRow).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    assert (await browser.post("/auth/refresh")).status_code == 401


async def test_refresh_without_a_session_is_unauthorized(
    db_session: AsyncSession, browser: AsyncClient
) -> None:
    assert (await browser.post("/auth/refresh")).status_code == 401
    browser.cookies.set(auth_api.SESSION_COOKIE, "unknown", domain="api.test", path="/auth")
    assert (await browser.post("/auth/refresh")).status_code == 401


async def test_refresh_from_a_foreign_origin_is_forbidden(browser: AsyncClient) -> None:
    response = await browser.post("/auth/refresh", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


async def test_refresh_is_rate_limited(browser: AsyncClient) -> None:
    for _ in range(auth_api.REFRESH_THROTTLE.limit):
        auth_api.REFRESH_THROTTLE.check("127.0.0.1")
    assert (await browser.post("/auth/refresh")).status_code == 429


async def test_logout_ends_the_session_and_clears_the_cookie(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _sign_in(browser, monkeypatch, _identity())
    response = await browser.post("/auth/logout", headers={"Origin": FRONTEND})
    assert response.status_code == 204
    assert 'exlibris_session=""' in response.headers["set-cookie"]
    row = (await db_session.execute(select(AuthSessionRow))).scalar_one()
    assert row.revoked_at is not None
    assert (await browser.post("/auth/refresh")).status_code == 401


async def test_logout_without_a_session_still_answers(
    db_session: AsyncSession, browser: AsyncClient
) -> None:
    assert (await browser.post("/auth/logout")).status_code == 204


async def test_erasing_a_user_deletes_their_sign_in(
    db_session: AsyncSession, browser: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _sign_in(browser, monkeypatch, _identity())
    identity = (await db_session.execute(select(AuthIdentityRow))).scalar_one()
    await account_repo.erase_personal_rows(db_session, identity.user_id)
    assert (await db_session.execute(select(AuthIdentityRow))).first() is None
    assert (await db_session.execute(select(AuthSessionRow))).first() is None


def test_the_app_refuses_to_start_without_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "auth_token_secret", "")
    with pytest.raises(tokens.MissingSecretError), TestClient(app):
        pass  # pragma: no cover - startup fails first
