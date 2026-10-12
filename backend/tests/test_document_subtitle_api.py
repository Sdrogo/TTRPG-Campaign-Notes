"""A Document's subtitle (spec 28_0): set on create and edit, sent in every
Document response, found by search, exported and kept in the history, and
never shown to a member who can't see the Document (VR-07)."""

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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> tuple[str, str, str]:
    """(room_id, master_token, player_token)."""
    master = make_token(str(uuid.uuid4()))
    room = (await client.post("/rooms", json={"name": "Tokyo"}, headers=_auth(master))).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=_auth(master)
        )
    ).json()
    player = make_token(str(uuid.uuid4()))
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth(player))
    return room["id"], master, player


async def _create(client: AsyncClient, room_id: str, token: str, **body: Any) -> dict[str, Any]:
    response = await client.post(f"/rooms/{room_id}/documents", json=body, headers=_auth(token))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def test_a_subtitle_is_set_cleaned_kept_and_cleared(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master, _ = await _room(client, make_token)
    document = await _create(
        client, room_id, master, name="Hoshino Mirai", subtitle="  La \n Idol "
    )
    assert document["subtitle"] == "La Idol"
    blank = await _create(client, room_id, master, name="Plain", subtitle="   ")
    assert blank["subtitle"] is None

    url = f"/rooms/{room_id}/documents/{document['id']}"
    kept = await client.patch(url, json={"description": "Sings."}, headers=_auth(master))
    assert kept.json()["subtitle"] == "La Idol"
    changed = await client.patch(url, json={"subtitle": "The Idol"}, headers=_auth(master))
    assert changed.json()["subtitle"] == "The Idol"
    listed = (await client.get(f"/rooms/{room_id}/documents", headers=_auth(master))).json()
    assert {d["name"]: d["subtitle"] for d in listed} == {
        "Hoshino Mirai": "The Idol",
        "Plain": None,
    }
    cleared = await client.patch(url, json={"subtitle": None}, headers=_auth(master))
    assert cleared.json()["subtitle"] is None


async def test_a_subtitle_over_120_characters_is_refused(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master, _ = await _room(client, make_token)
    too_long = await client.post(
        f"/rooms/{room_id}/documents",
        json={"name": "A", "subtitle": "x" * 121},
        headers=_auth(master),
    )
    assert too_long.status_code == 422
    assert "120" in too_long.json()["detail"]

    document = await _create(client, room_id, master, name="A", subtitle="x" * 120)
    edit = await client.patch(
        f"/rooms/{room_id}/documents/{document['id']}",
        json={"subtitle": "y" * 121},
        headers=_auth(master),
    )
    assert edit.status_code == 422


async def test_search_finds_a_document_by_its_subtitle_only_for_who_sees_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master, player = await _room(client, make_token)
    await _create(client, room_id, master, name="Hoshino Mirai", subtitle="La Idol")
    await _create(client, room_id, master, name="Kuro", subtitle="Idol hunter", visibility="master")

    async def found(token: str) -> list[dict[str, Any]]:
        response = await client.get(
            f"/rooms/{room_id}/search", params={"q": "idol"}, headers=_auth(token)
        )
        return list(response.json()["documents"]["items"])

    master_hits = await found(master)
    assert {hit["document_name"] for hit in master_hits} == {"Hoshino Mirai", "Kuro"}
    mirai = next(hit for hit in master_hits if hit["document_name"] == "Hoshino Mirai")
    assert mirai["excerpt"]["text"].startswith("La Idol")
    assert [hit["document_name"] for hit in await found(player)] == ["Hoshino Mirai"]


async def test_the_export_carries_the_subtitle_of_visible_documents_only(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master, player = await _room(client, make_token)
    await _create(client, room_id, master, name="Hoshino Mirai", subtitle="La Idol")
    await _create(client, room_id, master, name="Kuro", subtitle="Secret", visibility="master")

    exported = await client.get(
        f"/rooms/{room_id}/export", params={"format": "json"}, headers=_auth(player)
    )
    assert [(d["name"], d["subtitle"]) for d in exported.json()["documents"]] == [
        ("Hoshino Mirai", "La Idol")
    ]
    markdown = await client.get(
        f"/rooms/{room_id}/export", params={"format": "md"}, headers=_auth(player)
    )
    assert "*La Idol*" in markdown.text
    assert "Secret" not in markdown.text


async def test_the_history_records_and_restores_the_subtitle(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master, _ = await _room(client, make_token)
    document = await _create(client, room_id, master, name="Mirai", subtitle="La Idol")
    url = f"/rooms/{room_id}/documents/{document['id']}"
    other = make_token(str(uuid.uuid4()))
    # Another editor's save appends a revision instead of merging into the first.
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "master"}, headers=_auth(master)
        )
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth(other))
    await client.patch(url, json={"subtitle": "Retired"}, headers=_auth(other))

    versions = (await client.get(f"{url}/versions", headers=_auth(master))).json()
    assert len(versions) == 2
    oldest = (await client.get(f"{url}/versions/{versions[1]['id']}", headers=_auth(master))).json()
    assert oldest["subtitle"] == "La Idol"
    assert versions[0]["words_added"] == 1 and versions[0]["words_removed"] == 2

    restored = await client.post(
        f"{url}/versions/{versions[1]['id']}/restore", headers=_auth(master)
    )
    assert restored.json()["subtitle"] == "La Idol"
    assert (await client.get(url, headers=_auth(master))).json()["subtitle"] == "La Idol"
