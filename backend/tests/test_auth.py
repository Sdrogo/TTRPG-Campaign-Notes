from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

USER_ID = "11111111-1111-1111-1111-111111111111"


def test_me_without_token_is_unauthorized() -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_me_with_valid_token_resolves_user(make_token: Callable[..., str]) -> None:
    token = make_token(USER_ID, email="player@example.com")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"id": USER_ID, "email": "player@example.com"}


def test_me_with_expired_token_is_unauthorized(make_token: Callable[..., str]) -> None:
    token = make_token(USER_ID, exp=datetime.now(UTC) - timedelta(hours=1))
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_me_with_wrong_audience_is_unauthorized(make_token: Callable[..., str]) -> None:
    token = make_token(USER_ID, aud="something-else")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
