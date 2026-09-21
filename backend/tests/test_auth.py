from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.auth import jwt as auth_jwt
from app.config import settings
from app.main import app

_private_key = ec.generate_private_key(ec.SECP256R1())
_public_key = _private_key.public_key()


@dataclass
class _FakeSigningKey:
    key: object


class _FakeJwkClient:
    def get_signing_key_from_jwt(self, token: str) -> _FakeSigningKey:
        return _FakeSigningKey(key=_public_key)


@pytest.fixture(autouse=True)
def _patch_jwk_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_jwt, "_jwk_client", lambda: _FakeJwkClient())


def _make_token(**overrides: object) -> str:
    payload = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "email": "player@example.com",
        "aud": "authenticated",
        "iss": settings.supabase_issuer,
        "exp": datetime.now(UTC) + timedelta(hours=1),
        **overrides,
    }
    return jwt.encode(payload, _private_key, algorithm="ES256")


client = TestClient(app)


def test_me_without_token_is_unauthorized() -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_me_with_valid_token_resolves_user() -> None:
    token = _make_token()
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {
        "id": "11111111-1111-1111-1111-111111111111",
        "email": "player@example.com",
    }


def test_me_with_expired_token_is_unauthorized() -> None:
    token = _make_token(exp=datetime.now(UTC) - timedelta(hours=1))
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_me_with_wrong_audience_is_unauthorized() -> None:
    token = _make_token(aud="something-else")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
