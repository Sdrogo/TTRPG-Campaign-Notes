import uuid
from collections.abc import AsyncIterator, Callable

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_create_room_makes_creator_master_and_admin(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    user_id = str(uuid.uuid4())
    token = make_token(user_id, email="master@example.com")

    response = await client.post(
        "/rooms",
        json={"name": "Curse of Strahd", "game_system": "D&D 5e"},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201
    room = response.json()
    assert room["name"] == "Curse of Strahd"

    listing = await client.get("/rooms", headers=_auth_headers(token))
    assert listing.status_code == 200
    [entry] = listing.json()
    assert entry["room"]["id"] == room["id"]
    assert entry["role"] == "master"
    assert entry["is_admin"] is True


@pytest.mark.usefixtures("db_session")
async def test_blank_room_name_is_rejected(
    make_token: Callable[..., str], client: AsyncClient
) -> None:
    token = make_token(str(uuid.uuid4()))
    response = await client.post("/rooms", json={"name": "   "}, headers=_auth_headers(token))
    assert response.status_code == 422


async def test_invite_then_accept_makes_the_second_user_a_player(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    admin_token = make_token(str(uuid.uuid4()))
    create = await client.post(
        "/rooms", json={"name": "Waterdeep"}, headers=_auth_headers(admin_token)
    )
    room = create.json()

    invite = await client.post(
        f"/rooms/{room['id']}/invitations",
        json={"role": "player"},
        headers=_auth_headers(admin_token),
    )
    assert invite.status_code == 201
    code = invite.json()["code"]

    player_token = make_token(str(uuid.uuid4()), email="player@example.com")
    accept = await client.post(f"/invitations/{code}/accept", headers=_auth_headers(player_token))
    assert accept.status_code == 200
    assert accept.json()["id"] == room["id"]

    listing = await client.get("/rooms", headers=_auth_headers(player_token))
    [entry] = listing.json()
    assert entry["role"] == "player"
    assert entry["is_admin"] is False


async def test_non_admin_cannot_create_invitations(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    admin_token = make_token(str(uuid.uuid4()))
    create = await client.post(
        "/rooms", json={"name": "Barovia"}, headers=_auth_headers(admin_token)
    )
    room = create.json()

    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations",
            json={"role": "player"},
            headers=_auth_headers(admin_token),
        )
    ).json()
    player_token = make_token(str(uuid.uuid4()))
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth_headers(player_token))

    forbidden = await client.post(
        f"/rooms/{room['id']}/invitations",
        json={"role": "player"},
        headers=_auth_headers(player_token),
    )
    assert forbidden.status_code == 403


async def test_accepting_twice_conflicts(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    admin_token = make_token(str(uuid.uuid4()))
    create = await client.post(
        "/rooms", json={"name": "Icewind Dale"}, headers=_auth_headers(admin_token)
    )
    room = create.json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations",
            json={"role": "player"},
            headers=_auth_headers(admin_token),
        )
    ).json()

    player_token = make_token(str(uuid.uuid4()))
    first = await client.post(
        f"/invitations/{invite['code']}/accept", headers=_auth_headers(player_token)
    )
    assert first.status_code == 200
    second = await client.post(
        f"/invitations/{invite['code']}/accept", headers=_auth_headers(player_token)
    )
    assert second.status_code == 409


@pytest.mark.usefixtures("db_session")
async def test_unknown_invitation_code_is_not_found(
    make_token: Callable[..., str], client: AsyncClient
) -> None:
    token = make_token(str(uuid.uuid4()))
    response = await client.post("/invitations/does-not-exist/accept", headers=_auth_headers(token))
    assert response.status_code == 404
