import uuid
from collections.abc import AsyncIterator, Callable

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


async def _create_room_and_join_as_player(
    client: AsyncClient, make_token: Callable[..., str]
) -> tuple[str, str, str, str]:
    """Returns (room_id, admin_token, player_user_id, player_token)."""
    admin_token = make_token(str(uuid.uuid4()), email="admin@example.com")
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(admin_token))
    ).json()

    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations",
            json={"role": "player"},
            headers=_auth_headers(admin_token),
        )
    ).json()

    player_user_id = str(uuid.uuid4())
    player_token = make_token(player_user_id, email="player@example.com")
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth_headers(player_token))

    return room["id"], admin_token, player_user_id, player_token


async def test_admin_promotes_player_to_master(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, admin_token, player_user_id, _ = await _create_room_and_join_as_player(
        client, make_token
    )

    response = await client.patch(
        f"/rooms/{room_id}/members/{player_user_id}",
        json={"role": "master"},
        headers=_auth_headers(admin_token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "master"
    assert body["email"] == "player@example.com"

    members = (
        await client.get(f"/rooms/{room_id}/members", headers=_auth_headers(admin_token))
    ).json()
    roles = {m["user_id"]: m["role"] for m in members}
    assert roles[player_user_id] == "master"


async def test_non_admin_cannot_change_roles(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, _, player_user_id, player_token = await _create_room_and_join_as_player(
        client, make_token
    )

    response = await client.patch(
        f"/rooms/{room_id}/members/{player_user_id}",
        json={"role": "master"},
        headers=_auth_headers(player_token),
    )
    assert response.status_code == 403


async def test_cannot_demote_the_last_master(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, admin_token, _, _ = await _create_room_and_join_as_player(client, make_token)
    members = (
        await client.get(f"/rooms/{room_id}/members", headers=_auth_headers(admin_token))
    ).json()
    master_id = next(m["user_id"] for m in members if m["role"] == "master")

    response = await client.patch(
        f"/rooms/{room_id}/members/{master_id}",
        json={"role": "player"},
        headers=_auth_headers(admin_token),
    )
    assert response.status_code == 409


async def test_admin_removes_a_member(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, admin_token, player_user_id, _ = await _create_room_and_join_as_player(
        client, make_token
    )

    response = await client.delete(
        f"/rooms/{room_id}/members/{player_user_id}", headers=_auth_headers(admin_token)
    )
    assert response.status_code == 204

    members = (
        await client.get(f"/rooms/{room_id}/members", headers=_auth_headers(admin_token))
    ).json()
    assert player_user_id not in {m["user_id"] for m in members}


async def test_member_can_leave_without_admin_rights(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, admin_token, player_user_id, player_token = await _create_room_and_join_as_player(
        client, make_token
    )

    response = await client.delete(
        f"/rooms/{room_id}/members/{player_user_id}", headers=_auth_headers(player_token)
    )
    assert response.status_code == 204


async def test_last_administrator_cannot_leave(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, admin_token, _, _ = await _create_room_and_join_as_player(client, make_token)
    members = (
        await client.get(f"/rooms/{room_id}/members", headers=_auth_headers(admin_token))
    ).json()
    admin_id = next(m["user_id"] for m in members if m["is_admin"])

    response = await client.delete(
        f"/rooms/{room_id}/members/{admin_id}", headers=_auth_headers(admin_token)
    )
    assert response.status_code == 409


async def test_token_without_email_keeps_the_stored_email(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    user_id = str(uuid.uuid4())
    with_email = make_token(user_id, email="gm@example.com")
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(with_email))
    ).json()

    # A later request whose token has no email claim must not wipe it.
    without_email = make_token(user_id)
    response = await client.post(
        "/rooms", json={"name": "Ravenloft"}, headers=_auth_headers(without_email)
    )
    assert response.status_code == 201

    members = (
        await client.get(f"/rooms/{room['id']}/members", headers=_auth_headers(with_email))
    ).json()
    assert members[0]["email"] == "gm@example.com"
