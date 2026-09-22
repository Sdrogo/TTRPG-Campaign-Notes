import io
import uuid
from collections.abc import AsyncIterator, Callable, Collection
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import remote_images, storage, storage_cleanup, users_repo
from app.db.models import StorageCleanupRow
from app.domain.images import AVATAR_DIMENSION
from app.domain.profiles import MAX_DISPLAY_NAME_LENGTH
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _png(size: tuple[int, int] = (800, 600)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def _headers(make_token: Callable[..., str], user_id: str, email: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id, email=email)}"}


async def _upload_avatar(
    client: AsyncClient, headers: dict[str, str], data: bytes
) -> tuple[int, dict[str, object]]:
    response = await client.post(
        "/account/avatar", files={"file": ("me.png", data, "image/png")}, headers=headers
    )
    return response.status_code, response.json()


async def _cleanup_rows(session: AsyncSession, paths: Collection[str]) -> list[str]:
    result = await session.execute(
        select(StorageCleanupRow.storage_path).where(StorageCleanupRow.storage_path.in_(paths))
    )
    return list(result.scalars())


async def _signed(path: str) -> str:
    return (await storage.signed_urls([path]))[path]


def _after_grace() -> datetime:
    return datetime.now(UTC) + 2 * storage_cleanup.SWEEP_GRACE


# --- Profile fields ------------------------------------------------------


async def test_account_requires_authentication(client: AsyncClient) -> None:
    assert (await client.get("/account")).status_code == 401
    assert (await client.patch("/account", json={"display_name": "x"})).status_code == 401


async def test_new_user_gets_an_empty_profile_with_their_token_email(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    user_id = str(uuid.uuid4())
    response = await client.get(
        "/account", headers=_headers(make_token, user_id, "new@example.com")
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": user_id,
        "email": "new@example.com",
        "display_name": None,
        "pronouns": None,
        "bio": None,
        "avatar_url": None,
    }


async def test_user_edits_their_profile(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    headers = _headers(make_token, str(uuid.uuid4()), "ireena@example.com")

    response = await client.patch(
        "/account",
        json={"display_name": "  Ireena  ", "pronouns": "she/her", "bio": "Line 1\nLine 2"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Ireena"
    assert body["pronouns"] == "she/her"
    assert body["bio"] == "Line 1\nLine 2"
    assert body["email"] == "ireena@example.com"

    assert (await client.get("/account", headers=headers)).json() == body


async def test_partial_update_leaves_other_fields_and_blank_clears(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    headers = _headers(make_token, str(uuid.uuid4()), "a@example.com")
    await client.patch(
        "/account", json={"display_name": "Ismark", "pronouns": "he/him"}, headers=headers
    )

    body = (await client.patch("/account", json={"pronouns": " "}, headers=headers)).json()

    assert body["display_name"] == "Ismark"
    assert body["pronouns"] is None


async def test_too_long_name_is_rejected(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    headers = _headers(make_token, str(uuid.uuid4()), "a@example.com")
    response = await client.patch(
        "/account", json={"display_name": "a" * (MAX_DISPLAY_NAME_LENGTH + 1)}, headers=headers
    )

    assert response.status_code == 422
    assert (await client.get("/account", headers=headers)).json()["display_name"] is None


async def test_members_list_shows_the_chosen_name_and_avatar(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    user_id = str(uuid.uuid4())
    headers = _headers(make_token, user_id, "master@example.com")
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=headers)).json()
    await client.patch(
        "/account", json={"display_name": "Strahd", "pronouns": "he/him"}, headers=headers
    )
    _, account = await _upload_avatar(client, headers, _png())

    (member,) = (await client.get(f"/rooms/{room['id']}/members", headers=headers)).json()

    assert member["user_id"] == user_id
    assert member["email"] == "master@example.com"
    assert member["display_name"] == "Strahd"
    assert member["pronouns"] == "he/him"
    assert member["avatar_url"] == account["avatar_url"]


# --- Avatar ----------------------------------------------------------------


async def test_uploaded_avatar_is_cropped_to_a_small_square(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    user_id = str(uuid.uuid4())
    status_code, body = await _upload_avatar(
        client, _headers(make_token, user_id, None), _png((2400, 1200))
    )

    assert status_code == 200
    (path, stored) = next(iter(fake_storage.items()))
    assert path.startswith(f"avatars/{user_id}/")
    assert body["avatar_url"] == await _signed(path)
    with Image.open(io.BytesIO(stored)) as image:
        assert image.format == "WEBP"
        assert image.size == (AVATAR_DIMENSION, AVATAR_DIMENSION)
    assert await _cleanup_rows(db_session, [path]) == []


async def test_replacing_the_avatar_removes_the_old_one(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    headers = _headers(make_token, str(uuid.uuid4()), None)
    await _upload_avatar(client, headers, _png())
    (old_path,) = fake_storage

    _, body = await _upload_avatar(client, headers, _png((300, 300)))

    (new_path,) = fake_storage
    assert new_path != old_path
    assert body["avatar_url"] == await _signed(new_path)


async def test_user_removes_their_avatar(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    headers = _headers(make_token, str(uuid.uuid4()), None)
    await _upload_avatar(client, headers, _png())

    response = await client.delete("/account/avatar", headers=headers)

    assert response.status_code == 200
    assert response.json()["avatar_url"] is None
    assert fake_storage == {}


async def test_avatar_can_be_imported_from_a_url(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[str] = []

    async def fake_fetch(url: str) -> bytes:
        requested.append(url)
        return _png()

    monkeypatch.setattr(remote_images, "fetch_image_bytes", fake_fetch)
    response = await client.post(
        "/account/avatar/from-url",
        json={"url": "https://example.com/me.png"},
        headers=_headers(make_token, str(uuid.uuid4()), None),
    )

    assert response.status_code == 200
    assert requested == ["https://example.com/me.png"]
    assert len(fake_storage) == 1


async def test_non_image_avatar_is_rejected(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    status_code, _ = await _upload_avatar(
        client, _headers(make_token, str(uuid.uuid4()), None), b"not an image"
    )

    assert status_code == 422
    assert fake_storage == {}


async def test_sweep_never_removes_an_avatar_in_use(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    await _upload_avatar(client, _headers(make_token, str(uuid.uuid4()), None), _png())
    (path,) = fake_storage

    # E.g. a stale cleanup row left behind for the same path.
    await storage_cleanup.record_pending_upload(path)
    await storage_cleanup.sweep(db_session, now=_after_grace())

    assert path in fake_storage
    assert await _cleanup_rows(db_session, [path]) == []


async def test_avatar_upload_whose_transaction_fails_is_swept_later(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_save(session: AsyncSession, profile: object) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(users_repo, "save_profile", failing_save)
    with pytest.raises(RuntimeError):
        await _upload_avatar(client, _headers(make_token, str(uuid.uuid4()), None), _png())

    (orphan,) = fake_storage
    assert await _cleanup_rows(db_session, [orphan]) == [orphan]

    await storage_cleanup.sweep(db_session, now=_after_grace())
    assert fake_storage == {}


# --- Google defaults ---------------------------------------------------------

GOOGLE_PICTURE = "https://lh3.googleusercontent.com/a/ACg8oc123=s96-c"


def _google_headers(
    make_token: Callable[..., str], user_id: str, name: str | None = "Ireena Kolyana"
) -> dict[str, str]:
    metadata = {"full_name": name, "avatar_url": GOOGLE_PICTURE, "email": "i@example.com"}
    token = make_token(user_id, email="i@example.com", user_metadata=metadata)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def google_fetches(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    requested: list[str] = []

    async def fake_fetch(url: str) -> bytes:
        requested.append(url)
        return _png((96, 96))

    monkeypatch.setattr(remote_images, "fetch_image_bytes", fake_fetch)
    return requested


async def test_first_visit_copies_the_google_name_and_picture(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    google_fetches: list[str],
) -> None:
    user_id = str(uuid.uuid4())
    body = (await client.get("/account", headers=_google_headers(make_token, user_id))).json()

    assert body["display_name"] == "Ireena Kolyana"
    (path,) = fake_storage
    assert path.startswith(f"avatars/{user_id}/")
    assert body["avatar_url"] == await _signed(path)
    # Asked at the stored size, not Google's 96px default.
    assert google_fetches == [
        f"https://lh3.googleusercontent.com/a/ACg8oc123=s{AVATAR_DIMENSION}-c"
    ]
    assert await _cleanup_rows(db_session, [path]) == []


async def test_google_defaults_are_copied_only_once(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    google_fetches: list[str],
) -> None:
    headers = _google_headers(make_token, str(uuid.uuid4()))
    await client.get("/account", headers=headers)
    await client.patch("/account", json={"display_name": None}, headers=headers)
    await client.delete("/account/avatar", headers=headers)

    body = (await client.get("/account", headers=headers)).json()

    assert body["display_name"] is None
    assert body["avatar_url"] is None
    assert len(google_fetches) == 1


async def test_google_defaults_never_replace_what_the_user_set(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    google_fetches: list[str],
) -> None:
    user_id = str(uuid.uuid4())
    plain = _headers(make_token, user_id, "i@example.com")
    await client.patch("/account", json={"display_name": "Ireena"}, headers=plain)
    await _upload_avatar(client, plain, _png())
    (own_avatar,) = fake_storage

    body = (await client.get("/account", headers=_google_headers(make_token, user_id))).json()

    assert body["display_name"] == "Ireena"
    assert body["avatar_url"] == await _signed(own_avatar)
    assert google_fetches == []


async def test_unreachable_google_picture_still_copies_the_name(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_fetch(url: str) -> bytes:
        raise remote_images.RemoteImageError("Could not fetch the image")

    monkeypatch.setattr(remote_images, "fetch_image_bytes", failing_fetch)
    response = await client.get("/account", headers=_google_headers(make_token, str(uuid.uuid4())))

    assert response.status_code == 200
    assert response.json()["display_name"] == "Ireena Kolyana"
    assert response.json()["avatar_url"] is None
    assert fake_storage == {}


async def test_prefilled_name_shows_in_the_members_list(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    google_fetches: list[str],
) -> None:
    headers = _google_headers(make_token, str(uuid.uuid4()))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=headers)).json()
    await client.get("/account", headers=headers)

    (member,) = (await client.get(f"/rooms/{room['id']}/members", headers=headers)).json()

    assert member["display_name"] == "Ireena Kolyana"
    assert member["avatar_url"] is not None
