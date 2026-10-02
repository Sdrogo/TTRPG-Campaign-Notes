"""`@` mentions in Comments (spec 19c Decision 2): stored as
`@[Name](user:<uuid>)` for members only, turned back into plain text for
anyone else, on creation and on edit."""

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


def _headers(make_token: Callable[..., str], user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


async def _setup(
    client: AsyncClient, make_token: Callable[..., str]
) -> tuple[str, dict[str, str], str, str]:
    """A Room with a Master and a Player, and a Document: returns the
    Comments URL, the Master's headers, the Master's id and the Player's."""
    master_id, player_id = str(uuid.uuid4()), str(uuid.uuid4())
    master = _headers(make_token, master_id)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    joined = await client.post(
        f"/invitations/{invite['code']}/accept", headers=_headers(make_token, player_id)
    )
    assert joined.status_code in (200, 201)
    document = (
        await client.post(f"/rooms/{room['id']}/documents", json={"name": "Castle"}, headers=master)
    ).json()
    return f"/rooms/{room['id']}/documents/{document['id']}/comments", master, master_id, player_id


async def test_a_member_mention_is_kept_and_an_outsider_becomes_text(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _, player_id = await _setup(client, make_token)
    outsider = uuid.uuid4()
    body = f"@[Ezmerelda](user:{player_id}) and @[Strahd](user:{outsider}), look."

    created = await client.post(url, json={"body": body}, headers=master)

    assert created.status_code == 201, created.text
    expected = f"@[Ezmerelda](user:{player_id}) and @Strahd, look."
    assert created.json()["body"] == expected
    listed = (await client.get(url, headers=master)).json()
    assert listed[0]["body"] == expected


async def test_an_edit_cleans_its_mentions_too(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, master_id, _ = await _setup(client, make_token)
    comment = (await client.post(url, json={"body": "Hello"}, headers=master)).json()

    edited = await client.patch(
        f"{url}/{comment['id']}",
        json={"body": f"@[Me](user:{master_id}) @[Ghost](user:{uuid.uuid4()})"},
        headers=master,
    )

    assert edited.status_code == 200, edited.text
    assert edited.json()["body"] == f"@[Me](user:{master_id}) @Ghost"
    # An edit that leaves the body alone doesn't touch it.
    kept = await client.patch(f"{url}/{comment['id']}", json={"visibility": "room"}, headers=master)
    assert kept.json()["body"] == f"@[Me](user:{master_id}) @Ghost"
