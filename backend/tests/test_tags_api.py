import uuid
from collections.abc import AsyncIterator, Callable

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_master_can_create_and_list_a_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    master_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(master_token))
    ).json()

    response = await client.post(
        f"/rooms/{room['id']}/tags",
        json={"name": "Faction", "category": "Type"},
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Faction"

    tags = (
        await client.get(f"/rooms/{room['id']}/tags", headers=_auth_headers(master_token))
    ).json()
    names = {t["name"] for t in tags}
    assert {"NPC", "Place", "Event", "Artifact", "Faction"} <= names


async def test_player_cannot_create_a_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    master_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(master_token))
    ).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations",
            json={"role": "player"},
            headers=_auth_headers(master_token),
        )
    ).json()
    player_token = make_token(str(uuid.uuid4()))
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth_headers(player_token))

    response = await client.post(
        f"/rooms/{room['id']}/tags",
        json={"name": "Faction"},
        headers=_auth_headers(player_token),
    )
    assert response.status_code == 403


async def test_duplicate_tag_name_conflicts(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    master_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(master_token))
    ).json()

    response = await client.post(
        f"/rooms/{room['id']}/tags", json={"name": "NPC"}, headers=_auth_headers(master_token)
    )
    assert response.status_code == 409
