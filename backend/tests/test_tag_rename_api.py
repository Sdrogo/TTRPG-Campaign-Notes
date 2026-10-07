"""Renaming a Tag (spec 25c): who may, what it refuses, and that everything
referring to the Tag by id shows the new name."""

import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _headers(make_token: Callable[..., str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(str(uuid.uuid4()))}"}


async def _join(
    client: AsyncClient, room_url: str, master: dict[str, str], headers: dict[str, str], role: str
) -> None:
    invite = (
        await client.post(f"{room_url}/invitations", json={"role": role}, headers=master)
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=headers)


async def _room(
    client: AsyncClient, make_token: Callable[..., str]
) -> tuple[str, dict[str, str], dict[str, str]]:
    """A Room's URL, its creator's (Administrator and Master) headers and a Player's."""
    master = _headers(make_token)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    url = f"/rooms/{room['id']}"
    player = _headers(make_token)
    await _join(client, url, master, player, "player")
    return url, master, player


async def _tag(client: AsyncClient, url: str, headers: dict[str, str], name: str) -> Any:
    response = await client.post(f"{url}/tags", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _rename(
    client: AsyncClient, url: str, tag_id: str, headers: dict[str, str], name: str
) -> Any:
    return await client.patch(f"{url}/tags/{tag_id}", json={"name": name}, headers=headers)


async def test_an_administrator_renames_a_tag_and_keeps_its_category(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _ = await _room(client, make_token)
    created = (
        await client.post(
            f"{url}/tags", json={"name": "Fction", "category": "Type"}, headers=master
        )
    ).json()

    response = await _rename(client, url, created["id"], master, "  Faction ")

    assert response.status_code == 200
    assert response.json() == {**created, "name": "Faction"}
    tags = (await client.get(f"{url}/tags", headers=master)).json()
    assert {"Faction"} <= {t["name"] for t in tags}
    assert "Fction" not in {t["name"] for t in tags}


async def test_a_master_who_is_not_an_administrator_may_rename(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _ = await _room(client, make_token)
    co_master = _headers(make_token)
    await _join(client, url, master, co_master, "master")
    tag = await _tag(client, url, master, "Villain")

    response = await _rename(client, url, tag["id"], co_master, "Villains")

    assert response.status_code == 200
    assert response.json()["name"] == "Villains"


async def test_a_player_or_an_outsider_cannot_rename(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, player = await _room(client, make_token)
    tag = await _tag(client, url, master, "Villain")

    assert (await _rename(client, url, tag["id"], player, "Hero")).status_code == 403
    outsider = _headers(make_token)
    assert (await _rename(client, url, tag["id"], outsider, "Hero")).status_code == 403
    tags = (await client.get(f"{url}/tags", headers=master)).json()
    assert "Villain" in {t["name"] for t in tags}


async def test_another_rooms_tag_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _ = await _room(client, make_token)
    other_url, other_master, _ = await _room(client, make_token)
    foreign = await _tag(client, other_url, other_master, "Foreign")

    response = await _rename(client, url, foreign["id"], master, "Mine")

    assert response.status_code == 404
    other_tags = (await client.get(f"{other_url}/tags", headers=other_master)).json()
    assert "Foreign" in {t["name"] for t in other_tags}


async def test_a_blank_name_is_rejected(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _ = await _room(client, make_token)
    tag = await _tag(client, url, master, "Villain")

    assert (await _rename(client, url, tag["id"], master, "   ")).status_code == 422


async def test_a_taken_name_conflicts_and_the_request_stays_usable(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _ = await _room(client, make_token)
    tag = await _tag(client, url, master, "Villain")

    response = await _rename(client, url, tag["id"], master, "NPC")

    assert response.status_code == 409
    # The SAVEPOINT absorbed the failure: the same Tag can still be renamed.
    assert (await _rename(client, url, tag["id"], master, "Hero")).status_code == 200


async def test_the_same_name_changes_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, _ = await _room(client, make_token)
    tag = await _tag(client, url, master, "Villain")

    response = await _rename(client, url, tag["id"], master, " Villain ")

    assert response.status_code == 200
    assert response.json() == tag


async def test_documents_main_items_and_search_follow_the_rename(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    url, master, player = await _room(client, make_token)
    tag = await _tag(client, url, master, "Vilain")
    await client.put(f"{url}/tags/main", json={"items": [{"tag_ids": [tag["id"]]}]}, headers=master)
    document = (
        await client.post(
            f"{url}/documents",
            json={"name": "Strahd", "tag_ids": [tag["id"]], "visibility": "room"},
            headers=master,
        )
    ).json()

    assert (await _rename(client, url, tag["id"], master, "Villain")).status_code == 200

    main = (await client.get(f"{url}/tags/main", headers=player)).json()
    assert main == [{"tag_ids": [tag["id"]]}]
    tags = {t["id"]: t["name"] for t in (await client.get(f"{url}/tags", headers=player)).json()}
    assert tags[tag["id"]] == "Villain"
    details = (await client.get(f"{url}/documents/{document['id']}", headers=player)).json()
    assert details["tag_ids"] == [tag["id"]]
    found = (await client.get(f"{url}/search", params={"q": "villain"}, headers=player)).json()
    assert [item["id"] for item in found["tags"]["items"]] == [tag["id"]]
    found = (await client.get(f"{url}/search", params={"q": "vilain"}, headers=player)).json()
    assert found["tags"]["items"] == []
