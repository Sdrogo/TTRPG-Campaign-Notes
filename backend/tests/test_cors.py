import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import add_cors

PRODUCTION = "https://exlibris.world"


def client_for(cors_origins: list[str]) -> TestClient:
    """A throwaway app with the production CORS wiring (`add_cors`)."""
    app = FastAPI()
    config = Settings(
        _env_file=None,  # type: ignore[call-arg]
        cors_origins=cors_origins,
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
    return client_for(cors_origins=[PRODUCTION])


def test_a_listed_origin_is_allowed(client: TestClient) -> None:
    assert preflight(client, PRODUCTION) == PRODUCTION


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.exlibris.world",
        "https://exlibris.world.evil.com",
        "http://exlibris.world",
        # Vercel Previews were allowed by a pattern until ticket 73 step 6.
        "https://ttrpg-campaign-notes-jspixip1f-rum11.vercel.app",
    ],
)
def test_any_other_origin_is_rejected(client: TestClient, origin: str) -> None:
    assert preflight(client, origin) is None


def test_cors_origins_of_the_wrong_type_is_rejected() -> None:
    # Passed straight through by the validator (it only special-cases str
    # and list), then rejected by pydantic's own type check against `list[str]`.
    with pytest.raises(ValueError, match="cors_origins"):
        Settings(_env_file=None, cors_origins=None)  # type: ignore[call-arg,arg-type]
