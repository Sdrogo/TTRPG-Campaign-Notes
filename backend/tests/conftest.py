from collections.abc import AsyncIterator, Callable, Collection, Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import jwt
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api import rate_limits
from app.auth import tokens
from app.config import settings
from app.db import session as session_module
from app.db import storage
from app.db.session import discard_after_commit, engine, get_session, run_after_commit
from app.main import app

TEST_TOKEN_SECRET = "test-secret-" + "x" * 40


@pytest.fixture(autouse=True)
def _auth_token_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "auth_token_secret", TEST_TOKEN_SECRET)


@pytest.fixture
def make_token() -> Callable[..., str]:
    """An access token as `/auth/refresh` issues it (app/auth/tokens.py),
    with any claim overridden."""

    def _make_token(user_id: str, email: str | None = None, **overrides: object) -> str:
        payload = {
            "sub": user_id,
            "email": email,
            "provider": "google",
            "aud": tokens.ACCESS_AUDIENCE,
            "iss": tokens.ISSUER,
            "exp": datetime.now(UTC) + timedelta(hours=1),
            **overrides,
        }
        return jwt.encode(payload, TEST_TOKEN_SECRET, algorithm="HS256")

    return _make_token


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """A session bound to a savepoint that's rolled back after the test,
    so integration tests leave no residue in whichever database
    `DATABASE_URL` points at (the Supabase project locally, a throwaway
    Postgres in CI) - even though route handlers call `session.commit()`,
    that only commits the savepoint, not the outer transaction."""
    async with engine.connect() as conn:
        outer_transaction = await conn.begin()
        session_factory = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        async with session_factory() as session:

            async def override_get_session() -> AsyncIterator[AsyncSession]:
                # Mirrors get_session's after-commit handling (minus the
                # real commit), so post-commit Storage cleanup runs here too.
                # Each real request has a fresh session; here they share one,
                # so rows an earlier request loaded are expired first, or a
                # Core upsert since then could be read back stale from the
                # identity map (whether it is depends on garbage collection).
                session.expire_all()
                try:
                    yield session
                    # Stands in for get_session's commit: without it, the
                    # next request's expire_all would drop changes this one
                    # left unflushed.
                    await session.flush()
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
    """In-memory stand-in for the images bucket: DB changes in these tests
    are rolled back (conftest.db_session), but real bucket uploads would
    not be, so Storage is faked here and verified live separately."""
    objects: dict[str, bytes] = {}

    async def fake_upload(path: str, data: bytes, content_type: str) -> None:
        objects[path] = data

    async def fake_remove(path: str) -> None:
        objects.pop(path, None)

    async def fake_create_signed_urls(paths: Collection[str], expires_in: int) -> dict[str, str]:
        # Like Storage: only objects that exist get a link.
        return {path: f"https://signed.test/{path}?token=t" for path in paths if path in objects}

    async def fake_download_signed(url: str, max_bytes: int) -> bytes:
        # The inverse of the signed links above, for the Room PDF job.
        path = url.removeprefix("https://signed.test/").split("?")[0]
        if path not in objects:
            raise storage.StorageError("Storage answered 404")
        return objects[path]

    monkeypatch.setattr(storage, "upload", fake_upload)
    monkeypatch.setattr(storage, "remove", fake_remove)
    monkeypatch.setattr(storage, "create_signed_urls", fake_create_signed_urls)

    async def fake_download(path: str, max_bytes: int) -> bytes:
        # An object read with the backend's key, for the Document import.
        if path not in objects:
            raise storage.StorageError("Storage answered 404")
        return objects[path]

    def fake_as_download(path: str, file_name: str) -> str:
        # Like the signed links above, with the attachment name visible.
        return f"https://signed.test/{path}?token=t&download={quote(file_name, safe='')}"

    monkeypatch.setattr(storage, "as_download", fake_as_download)
    monkeypatch.setattr(storage, "download_signed", fake_download_signed)
    monkeypatch.setattr(storage, "download", fake_download)
    return objects


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Marks every test that needs a database as `integration`, so a
    developer without one can run the rest with `-m "not integration"`.
    CI runs everything, against a throwaway Postgres
    (`.github/workflows/ci.yml`).

    Keyed on the `db_session` fixture rather than a list of files, so a new
    test that touches the database is classified correctly on its own.
    """
    for item in items:
        if "db_session" in getattr(item, "fixturenames", ()):
            item.add_marker(pytest.mark.integration)


@pytest.fixture(autouse=True)
def _render_in_process(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Room PDF job typesets in a child process in production; tests replace
    the renderer with fakes, which a child could not see."""
    from app.api import export_pdf_job

    monkeypatch.setattr(export_pdf_job, "_ISOLATE_RENDER", False)


@pytest.fixture(autouse=True)
def _fresh_rate_limits() -> Iterator[None]:
    """Spec 72: the per-user limits count in process memory, and tests reuse
    the app, so every test starts with empty windows."""
    rate_limits.reset_all()
    yield
    rate_limits.reset_all()
