import uuid
from collections.abc import AsyncIterator, Callable

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """A Room, its creator's headers, a plain Player's headers and the Room id."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _auth_headers(token: str) -> dict[str, str]:
    """A Room, its creator's headers, a plain Player's headers and the Room id."""
    return {"Authorization": f"Bearer {token}"}


async def test_master_can_create_and_list_a_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Master can create and list a tag."""
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
    """Player cannot create a tag."""
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


async def test_listing_tags_is_withheld_from_a_non_member(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Listing tags is withheld from a non member."""
    owner_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(owner_token))
    ).json()

    outsider_token = make_token(str(uuid.uuid4()))
    response = await client.get(f"/rooms/{room['id']}/tags", headers=_auth_headers(outsider_token))

    assert response.status_code == 403


async def test_a_blank_tag_name_is_rejected(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A blank tag name is rejected."""
    master_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(master_token))
    ).json()

    response = await client.post(
        f"/rooms/{room['id']}/tags", json={"name": "   "}, headers=_auth_headers(master_token)
    )

    assert response.status_code == 422


async def test_duplicate_tag_name_conflicts(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Duplicate tag name conflicts."""
    master_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(master_token))
    ).json()

    response = await client.post(
        f"/rooms/{room['id']}/tags", json={"name": "NPC"}, headers=_auth_headers(master_token)
    )
    assert response.status_code == 409


async def _room_with_player(
    make_token: Callable[..., str], client: AsyncClient
) -> tuple[dict[str, str], dict[str, str], str]:
    """A Room, its creator's headers, a plain Player's headers and the id."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player = _auth_headers(make_token(str(uuid.uuid4())))
    await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    return master, player, room["id"]


async def test_new_rooms_seed_the_default_tags_as_ordered_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """New rooms seed the default tags as ordered main tags."""
    master, _, room_id = await _room_with_player(make_token, client)

    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()

    by_position = sorted(tags, key=lambda t: t["main_position"])
    assert [t["name"] for t in by_position] == ["NPC", "PC", "Place", "Event", "Artifact"]


async def test_a_new_tag_is_not_a_main_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A new tag is not a main tag."""
    master, _, room_id = await _room_with_player(make_token, client)

    created = await client.post(
        f"/rooms/{room_id}/tags", json={"name": "Faction", "category": "Type"}, headers=master
    )

    assert created.json()["main_position"] is None


async def test_administrator_sets_and_reorders_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Administrator sets and reorders main tags."""
    master, _, room_id = await _room_with_player(make_token, client)
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    ids = {t["name"]: t["id"] for t in tags}

    response = await client.put(
        f"/rooms/{room_id}/tags/main",
        json={"tag_ids": [ids["Place"], ids["NPC"]]},
        headers=master,
    )

    assert response.status_code == 200
    positions = {t["name"]: t["main_position"] for t in response.json()}
    assert positions == {"Place": 0, "NPC": 1, "PC": None, "Event": None, "Artifact": None}
    # Persisted: a later read agrees.
    reread = {
        t["name"]: t["main_position"]
        for t in (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    }
    assert reread == positions


async def test_an_empty_list_clears_the_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """An empty list clears the main tags."""
    master, _, room_id = await _room_with_player(make_token, client)

    response = await client.put(f"/rooms/{room_id}/tags/main", json={"tag_ids": []}, headers=master)

    assert response.status_code == 200
    assert all(t["main_position"] is None for t in response.json())


async def test_a_player_cannot_set_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A player cannot set main tags."""
    _, player, room_id = await _room_with_player(make_token, client)

    response = await client.put(f"/rooms/{room_id}/tags/main", json={"tag_ids": []}, headers=player)

    assert response.status_code == 403


async def test_a_non_member_cannot_set_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A non member cannot set main tags."""
    _, _, room_id = await _room_with_player(make_token, client)
    outsider = _auth_headers(make_token(str(uuid.uuid4())))

    response = await client.put(
        f"/rooms/{room_id}/tags/main", json={"tag_ids": []}, headers=outsider
    )

    assert response.status_code == 403


async def test_a_repeated_main_tag_is_rejected_and_nothing_changes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A repeated main tag is rejected and nothing changes."""
    master, _, room_id = await _room_with_player(make_token, client)
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()

    response = await client.put(
        f"/rooms/{room_id}/tags/main",
        json={"tag_ids": [tags[0]["id"], tags[0]["id"]]},
        headers=master,
    )

    assert response.status_code == 422
    after = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    assert after == tags


async def test_another_rooms_tag_cannot_become_a_main_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Another rooms tag cannot become a main tag."""
    master, _, room_id = await _room_with_player(make_token, client)
    other = _auth_headers(make_token(str(uuid.uuid4())))
    other_room = (await client.post("/rooms", json={"name": "Other"}, headers=other)).json()
    foreign = (await client.get(f"/rooms/{other_room['id']}/tags", headers=other)).json()[0]

    response = await client.put(
        f"/rooms/{room_id}/tags/main", json={"tag_ids": [foreign["id"]]}, headers=master
    )

    assert response.status_code == 422
    # The other Room's Tag keeps its position.
    kept = (await client.get(f"/rooms/{other_room['id']}/tags", headers=other)).json()
    assert {t["id"]: t["main_position"] for t in kept}[foreign["id"]] == foreign["main_position"]


async def test_a_main_tag_can_be_demoted_and_keeps_its_category(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A seeded "Type" Tag (what older Rooms have) stops being a Main Tag when
    left out of the list, while the others keep their relative order."""
    master, _, room_id = await _room_with_player(make_token, client)
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    ordered = sorted(tags, key=lambda t: t["main_position"])
    keep = [t["id"] for t in ordered if t["name"] != "PC"]

    response = await client.put(
        f"/rooms/{room_id}/tags/main", json={"tag_ids": keep}, headers=master
    )

    by_name = {t["name"]: t for t in response.json()}
    assert by_name["PC"]["main_position"] is None
    assert by_name["PC"]["category"] == "Type"
    assert [
        t["name"]
        for t in sorted(
            (t for t in response.json() if t["main_position"] is not None),
            key=lambda t: t["main_position"],
        )
    ] == ["NPC", "Place", "Event", "Artifact"]
