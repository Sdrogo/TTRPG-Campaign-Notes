import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import add_cors

PRODUCTION = "https://ttrpg-campaign-notes-eight.vercel.app"
# Commit-preview hashes have no hyphens, so `[a-z0-9]+` can't run on into
# another account's scope: the host must end in exactly `-rum11`.
PREVIEW_PATTERN = r"https://ttrpg-campaign-notes-[a-z0-9]+-rum11\.vercel\.app"


def client_for(cors_origins: list[str], cors_origin_regex: str | None = None) -> TestClient:
    """A throwaway app with the production CORS wiring (`add_cors`)."""
    app = FastAPI()
    config = Settings(
        _env_file=None,  # type: ignore[call-arg]
        cors_origins=cors_origins,
        cors_origin_regex=cors_origin_regex,
    )
    add_cors(app, config)

    @app.get("/account")
    def account() -> dict[str, str]:
        return {}

    return TestClient(app)


def preflight(client: TestClient, origin: str) -> str | None:
    """The Access-Control-Allow-Origin a browser's preflight gets back."""
    response = client.options(
        "/account",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    allowed: str | None = response.headers.get("access-control-allow-origin")
    return allowed


@pytest.fixture
def client() -> TestClient:
    return client_for(cors_origins=[PRODUCTION], cors_origin_regex=PREVIEW_PATTERN)


@pytest.mark.parametrize(
    "origin",
    [
        PRODUCTION,
        "https://ttrpg-campaign-notes-jspixip1f-rum11.vercel.app",
        "https://ttrpg-campaign-notes-a1b2c3d4e-rum11.vercel.app",
    ],
)
def test_listed_origin_and_commit_previews_are_allowed(client: TestClient, origin: str) -> None:
    assert preflight(client, origin) == origin


@pytest.mark.parametrize(
    "origin",
    [
        # Another Vercel account whose scope merely ends in "-rum11".
        "https://ttrpg-campaign-notes-abc123-evil-rum11.vercel.app",
        # Branch-alias previews: excluded on purpose, since their hyphens
        # would make the look-alike above impossible to rule out.
        "https://ttrpg-campaign-notes-git-feature-x-rum11.vercel.app",
        "https://evil-ttrpg-campaign-notes-abc123-rum11.vercel.app",
        "https://ttrpg-campaign-notes-abc123-rum11.vercel.app.evil.com",
        "http://ttrpg-campaign-notes-abc123-rum11.vercel.app",
        "https://ttrpg-campaign-notes-abc123-rum11xvercel.app",
    ],
)
def test_look_alike_origins_are_rejected(client: TestClient, origin: str) -> None:
    assert preflight(client, origin) is None


def test_the_looser_pattern_would_admit_the_look_alike() -> None:
    """Why the pattern above excludes hyphens: `[a-z0-9-]+` swallows another
    account's scope name."""
    loose = r"https://ttrpg-campaign-notes-[a-z0-9-]+-rum11\.vercel\.app"
    assert re.fullmatch(loose, "https://ttrpg-campaign-notes-abc123-evil-rum11.vercel.app")


def test_without_a_pattern_only_listed_origins_are_allowed() -> None:
    client = client_for(cors_origins=[PRODUCTION])
    assert preflight(client, PRODUCTION) == PRODUCTION
    assert preflight(client, "https://ttrpg-campaign-notes-jspixip1f-rum11.vercel.app") is None


def test_cors_origin_regex_defaults_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGIN_REGEX", raising=False)
    assert Settings(_env_file=None).cors_origin_regex is None  # type: ignore[call-arg]


@pytest.mark.parametrize("value", ["", "   "])
def test_blank_cors_origin_regex_means_unset(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """A dashboard may keep an emptied variable rather than delete it."""
    monkeypatch.setenv("CORS_ORIGIN_REGEX", value)
    assert Settings(_env_file=None).cors_origin_regex is None  # type: ignore[call-arg]


def test_cors_origin_regex_is_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGIN_REGEX", f"  {PREVIEW_PATTERN}\n")
    assert Settings(_env_file=None).cors_origin_regex == PREVIEW_PATTERN  # type: ignore[call-arg]


def test_invalid_cors_origin_regex_fails_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGIN_REGEX", "https://(unclosed")
    with pytest.raises(ValueError, match="CORS_ORIGIN_REGEX"):
        Settings(_env_file=None)  # type: ignore[call-arg]
