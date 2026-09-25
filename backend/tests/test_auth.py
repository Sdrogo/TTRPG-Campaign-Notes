from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from app.auth.dependencies import CurrentUser, get_current_user
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


def _user_from(make_token: Callable[..., str], metadata: dict[str, object]) -> CurrentUser:
    token = make_token(USER_ID, user_metadata=metadata)
    return get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), locale="en"
    )


# The claims Supabase puts in `user_metadata` for each enabled provider.
@pytest.mark.parametrize(
    ("metadata", "name", "picture"),
    [
        (  # Google
            {"full_name": "Ireena Kolyana", "picture": "https://lh3.googleusercontent.com/a/x"},
            "Ireena Kolyana",
            "https://lh3.googleusercontent.com/a/x",
        ),
        (  # Discord
            {"full_name": "strahd", "avatar_url": "https://cdn.discordapp.com/avatars/1/a.png"},
            "strahd",
            "https://cdn.discordapp.com/avatars/1/a.png",
        ),
        (  # GitHub, with no profile name set: only the handle
            {"user_name": "vanrichten", "avatar_url": "https://avatars.githubusercontent.com/u/1"},
            "vanrichten",
            "https://avatars.githubusercontent.com/u/1",
        ),
        (  # X
            {
                "name": "Ezmerelda",
                "user_name": "ezmerelda",
                "avatar_url": "https://pbs.twimg.com/a.jpg",
            },
            "Ezmerelda",
            "https://pbs.twimg.com/a.jpg",
        ),
    ],
)
def test_profile_defaults_are_read_for_every_provider(
    make_token: Callable[..., str], metadata: dict[str, object], name: str, picture: str
) -> None:
    user = _user_from(make_token, metadata)
    assert (user.google_name, user.google_picture_url) == (name, picture)


def test_a_real_name_is_preferred_over_the_handle(make_token: Callable[..., str]) -> None:
    user = _user_from(make_token, {"preferred_username": "rahadin", "full_name": "Rahadin"})
    assert user.google_name == "Rahadin"


def test_no_identity_claims_leave_the_defaults_unset(make_token: Callable[..., str]) -> None:
    user = _user_from(make_token, {})
    assert (user.google_name, user.google_picture_url) == (None, None)
