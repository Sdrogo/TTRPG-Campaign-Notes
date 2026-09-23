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


async def _room_with_master_and_player(
    client: AsyncClient, make_token: Callable[..., str]
) -> tuple[str, str, str]:
    """Returns (room_id, master_token, player_token)."""
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
    return room["id"], master_token, player_token


async def test_creator_becomes_owner_with_room_visibility_by_default(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, _ = await _room_with_master_and_player(client, make_token)

    response = await client.post(
        f"/rooms/{room_id}/documents",
        json={"name": "The Winking Skull", "description": "A tavern."},
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["visibility"] == "room"
    assert len(body["owner_ids"]) == 1


async def test_player_can_create_document_by_default(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, _, player_token = await _room_with_master_and_player(client, make_token)
    response = await client.post(
        f"/rooms/{room_id}/documents", json={"name": "A Player Document"},
        headers=_auth_headers(player_token),
    )
    assert response.status_code == 201


async def test_player_cannot_create_document_when_master_disables_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, player_token = await _room_with_master_and_player(client, make_token)
    toggle = await client.patch(
        f"/rooms/{room_id}", json={"players_can_create_documents": False},
        headers=_auth_headers(master_token),
    )
    assert toggle.status_code == 200

    response = await client.post(
        f"/rooms/{room_id}/documents", json={"name": "Should fail"},
        headers=_auth_headers(player_token),
    )
    assert response.status_code == 403


async def test_only_owner_or_master_can_edit_description(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, _, player_token = await _room_with_master_and_player(client, make_token)
    document = (
        await client.post(
            f"/rooms/{room_id}/documents", json={"name": "Owned by Player"},
            headers=_auth_headers(player_token),
        )
    ).json()

    other_token = make_token(str(uuid.uuid4()))
    # not even a member yet, but let's use a real member instead:
    forbidden = await client.patch(
        f"/rooms/{room_id}/documents/{document['id']}",
        json={"description": "Sneaky edit"},
        headers=_auth_headers(other_token),
    )
    assert forbidden.status_code == 403

    allowed = await client.patch(
        f"/rooms/{room_id}/documents/{document['id']}",
        json={"description": "Updated by its Owner"},
        headers=_auth_headers(player_token),
    )
    assert allowed.status_code == 200
    assert allowed.json()["description"] == "Updated by its Owner"


async def test_master_only_document_is_hidden_from_players(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, player_token = await _room_with_master_and_player(client, make_token)
    document = (
        await client.post(
            f"/rooms/{room_id}/documents",
            json={"name": "Secret Plot", "visibility": "master"},
            headers=_auth_headers(master_token),
        )
    ).json()

    hidden = await client.get(
        f"/rooms/{room_id}/documents/{document['id']}", headers=_auth_headers(player_token)
    )
    assert hidden.status_code == 404

    listing = (
        await client.get(f"/rooms/{room_id}/documents", headers=_auth_headers(player_token))
    ).json()
    assert document["id"] not in {d["id"] for d in listing}

    visible_to_master = await client.get(
        f"/rooms/{room_id}/documents/{document['id']}", headers=_auth_headers(master_token)
    )
    assert visible_to_master.status_code == 200


async def test_selective_document_visible_only_to_granted_users(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, player_token = await _room_with_master_and_player(client, make_token)

    granted_user_id = str(uuid.uuid4())
    granted_token = make_token(granted_user_id)
    invite2 = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"},
            headers=_auth_headers(master_token),
        )
    ).json()
    await client.post(
        f"/invitations/{invite2['code']}/accept", headers=_auth_headers(granted_token)
    )

    document = (
        await client.post(
            f"/rooms/{room_id}/documents",
            json={
                "name": "For your eyes only",
                "visibility": "selective",
                "selective_user_ids": [granted_user_id],
            },
            headers=_auth_headers(master_token),
        )
    ).json()

    visible = await client.get(
        f"/rooms/{room_id}/documents/{document['id']}", headers=_auth_headers(granted_token)
    )
    assert visible.status_code == 200

    hidden = await client.get(
        f"/rooms/{room_id}/documents/{document['id']}", headers=_auth_headers(player_token)
    )
    assert hidden.status_code == 404


async def test_owner_can_add_and_remove_another_owner(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, player_token = await _room_with_master_and_player(client, make_token)
    document = (
        await client.post(
            f"/rooms/{room_id}/documents", json={"name": "Shared doc"},
            headers=_auth_headers(master_token),
        )
    ).json()

    members = (
        await client.get(f"/rooms/{room_id}/members", headers=_auth_headers(master_token))
    ).json()
    player_id = next(m["user_id"] for m in members if m["role"] == "player")

    add = await client.post(
        f"/rooms/{room_id}/documents/{document['id']}/owners/{player_id}",
        headers=_auth_headers(master_token),
    )
    assert add.status_code == 201
    assert player_id in add.json()["owner_ids"]

    remove = await client.delete(
        f"/rooms/{room_id}/documents/{document['id']}/owners/{player_id}",
        headers=_auth_headers(master_token),
    )
    assert remove.status_code == 204


async def test_invalid_tag_id_is_rejected(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, _ = await _room_with_master_and_player(client, make_token)
    response = await client.post(
        f"/rooms/{room_id}/documents",
        json={"name": "Bad tags", "tag_ids": [str(uuid.uuid4())]},
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 422


async def test_duplicate_tag_and_grant_ids_are_collapsed(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room_id, master_token, _ = await _room_with_master_and_player(client, make_token)
    tag_id = (
        await client.get(f"/rooms/{room_id}/tags", headers=_auth_headers(master_token))
    ).json()[0]["id"]
    grantee = str(uuid.uuid4())

    created = await client.post(
        f"/rooms/{room_id}/documents",
        json={
            "name": "Duplicates",
            "visibility": "selective",
            "tag_ids": [tag_id, tag_id],
            "selective_user_ids": [grantee, grantee],
        },
        headers=_auth_headers(master_token),
    )
    assert created.status_code == 201
    assert created.json()["tag_ids"] == [tag_id]
    assert created.json()["selective_user_ids"] == [grantee]

    updated = await client.patch(
        f"/rooms/{room_id}/documents/{created.json()['id']}",
        json={"tag_ids": [tag_id, tag_id], "selective_user_ids": [grantee, grantee]},
        headers=_auth_headers(master_token),
    )
    assert updated.status_code == 200
    assert updated.json()["tag_ids"] == [tag_id]
    assert updated.json()["selective_user_ids"] == [grantee]
