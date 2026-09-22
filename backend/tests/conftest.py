from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth import jwt as auth_jwt
from app.config import settings
from app.db import session as session_module
from app.db import storage
from app.db.session import discard_after_commit, engine, get_session, run_after_commit
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


@pytest.fixture
def make_token() -> Callable[..., str]:
    def _make_token(user_id: str, email: str | None = None, **overrides: object) -> str:
        payload = {
            "sub": user_id,
            "email": email,
            "aud": "authenticated",
            "iss": settings.supabase_issuer,
            "exp": datetime.now(UTC) + timedelta(hours=1),
            **overrides,
        }
        return jwt.encode(payload, _private_key, algorithm="ES256")

    return _make_token


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """A session bound to a savepoint that's rolled back after the test,
    so integration tests against the real Supabase DB leave no residue -
    even though route handlers call `session.commit()`, that only commits
    the savepoint, not the outer transaction."""
    async with engine.connect() as conn:
        outer_transaction = await conn.begin()
        session_factory = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        async with session_factory() as session:

            async def override_get_session() -> AsyncIterator[AsyncSession]:
                # Mirrors get_session's after-commit handling (minus the
                # real commit), so post-commit Storage cleanup runs here too.
                try:
                    yield session
                except Exception:
                    discard_after_commit(session)
                    raise
                await run_after_commit(session)

            @asynccontextmanager
            async def same_session() -> AsyncIterator[AsyncSession]:
                # Writes meant to escape the request's transaction stay in
                # the test's savepoint too, so they're rolled back as well.
                yield session

            original_independent_session = session_module.independent_session
            session_module.independent_session = same_session
            app.dependency_overrides[get_session] = override_get_session
            try:
                yield session
            finally:
                app.dependency_overrides.pop(get_session, None)
                session_module.independent_session = original_independent_session
        await outer_transaction.rollback()


@pytest.fixture
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    """In-memory stand-in for Supabase Storage: DB changes in these tests
    are rolled back (conftest.db_session), but real bucket uploads would
    not be, so Storage is faked here and verified live separately."""
    objects: dict[str, bytes] = {}

    async def fake_upload(path: str, data: bytes, content_type: str) -> None:
        objects[path] = data

    async def fake_remove(path: str) -> None:
        objects.pop(path, None)

    monkeypatch.setattr(storage, "upload", fake_upload)
    monkeypatch.setattr(storage, "remove", fake_remove)
    return objects
