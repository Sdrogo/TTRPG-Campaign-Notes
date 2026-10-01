import uuid
from collections.abc import AsyncIterator, Callable

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _room(
    make_token: Callable[..., str], client: AsyncClient
) -> tuple[dict[str, str], dict[str, str], str, dict[str, str]]:
    """A Room: its creator's headers, a plain Player's headers, the Room id and
    the Tag ids by name."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player = _auth_headers(make_token(str(uuid.uuid4())))
    await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    tags = (await client.get(f"/rooms/{room['id']}/tags", headers=master)).json()
    return master, player, room["id"], {t["name"]: t["id"] for t in tags}


async def _put(
    client: AsyncClient, room_id: str, headers: dict[str, str], items: list[list[str]]
) -> Response:
    """Saves the Main items, each given as its list of Tag ids."""
    return await client.put(
        f"/rooms/{room_id}/tags/main",
        json={"items": [{"tag_ids": ids} for ids in items]},
        headers=headers,
    )


async def _get(client: AsyncClient, room_id: str, headers: dict[str, str]) -> list[list[str]]:
    """The Room's Main items as lists of Tag ids, in order."""
    response = await client.get(f"/rooms/{room_id}/tags/main", headers=headers)
    return [item["tag_ids"] for item in response.json()]


async def test_a_new_room_lists_its_default_tags_as_main_items(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 11: the defaults are the first Main items, in declaration order."""
    master, _, room_id, ids = await _room(make_token, client)

    items = await _get(client, room_id, master)

    names = {v: k for k, v in ids.items()}
    assert [names[i[0]] for i in items] == ["NPC", "PC", "Place", "Event", "Artifact"]


async def test_any_member_can_read_the_main_items(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """The Documents list needs them to group, for every member."""
    _, player, room_id, _ = await _room(make_token, client)

    response = await client.get(f"/rooms/{room_id}/tags/main", headers=player)

    assert response.status_code == 200


async def test_a_non_member_cannot_read_the_main_items(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Non-members get 403."""
    _, _, room_id, _ = await _room(make_token, client)
    outsider = _auth_headers(make_token(str(uuid.uuid4())))

    response = await client.get(f"/rooms/{room_id}/tags/main", headers=outsider)

    assert response.status_code == 403


async def test_administrator_sets_and_reorders_single_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 11: the list replaces the selection and is the new order."""
    master, _, room_id, ids = await _room(make_token, client)

    response = await _put(client, room_id, master, [[ids["Place"]], [ids["NPC"]]])

    assert response.status_code == 200
    assert [i["tag_ids"] for i in response.json()] == [[ids["Place"]], [ids["NPC"]]]
    assert await _get(client, room_id, master) == [[ids["Place"]], [ids["NPC"]]]
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    assert {t["name"]: t["main_position"] for t in tags} == {
        "Place": 0,
        "NPC": 1,
        "PC": None,
        "Event": None,
        "Artifact": None,
    }


async def test_a_combination_sits_between_single_main_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 11_2: a combination is a line item in the same order."""
    master, _, room_id, ids = await _room(make_token, client)
    combo = [ids["NPC"], ids["Place"]]

    response = await _put(client, room_id, master, [[ids["PC"]], combo, [ids["Event"]]])

    assert response.status_code == 200
    expected = [[ids["PC"]], combo, [ids["Event"]]]
    assert await _get(client, room_id, master) == expected


async def test_saving_again_replaces_the_previous_combinations(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A combination left out of the list is removed."""
    master, _, room_id, ids = await _room(make_token, client)
    await _put(client, room_id, master, [[ids["NPC"], ids["Place"]]])

    await _put(client, room_id, master, [[ids["Event"], ids["Artifact"]], [ids["PC"]]])

    assert await _get(client, room_id, master) == [[ids["Event"], ids["Artifact"]], [ids["PC"]]]


async def test_a_tag_can_be_single_and_part_of_several_combinations(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Combinations don't use a Tag up."""
    master, _, room_id, ids = await _room(make_token, client)
    items = [[ids["NPC"]], [ids["NPC"], ids["Place"]], [ids["NPC"], ids["Event"]]]

    response = await _put(client, room_id, master, items)

    assert response.status_code == 200
    assert await _get(client, room_id, master) == items


async def test_an_empty_list_clears_everything(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Singles and combinations alike."""
    master, _, room_id, ids = await _room(make_token, client)
    await _put(client, room_id, master, [[ids["NPC"], ids["Place"]], [ids["PC"]]])

    response = await _put(client, room_id, master, [])

    assert response.status_code == 200
    assert await _get(client, room_id, master) == []


async def test_a_main_tag_can_be_demoted_and_keeps_its_category(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A seeded "Type" Tag (what older Rooms have) stops being a Main Tag when
    left out of the list, while the others keep their relative order."""
    master, _, room_id, ids = await _room(make_token, client)
    keep = [[ids[n]] for n in ("NPC", "Place", "Event", "Artifact")]

    await _put(client, room_id, master, keep)

    listed = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    tags = {t["name"]: t for t in listed}
    assert tags["PC"]["main_position"] is None
    assert tags["PC"]["category"] == "Type"
    assert await _get(client, room_id, master) == keep


async def test_a_player_cannot_set_main_items(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Only an Administrator may."""
    _, player, room_id, _ = await _room(make_token, client)

    assert (await _put(client, room_id, player, [])).status_code == 403


async def test_a_non_member_cannot_set_main_items(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Non-members get 403."""
    _, _, room_id, _ = await _room(make_token, client)
    outsider = _auth_headers(make_token(str(uuid.uuid4())))

    assert (await _put(client, room_id, outsider, [])).status_code == 403


async def test_rejected_lists_change_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Empty item, repeated single, repeated Tag in a combination, repeated
    combination (in any order): all 422, and the saved items stay."""
    master, _, room_id, ids = await _room(make_token, client)
    before = await _get(client, room_id, master)
    npc, place = ids["NPC"], ids["Place"]

    bad_lists: list[list[list[str]]] = [
        [[]],
        [[npc], [npc]],
        [[npc, npc]],
        [[npc, place], [place, npc]],
    ]
    for bad in bad_lists:
        assert (await _put(client, room_id, master, bad)).status_code == 422

    assert await _get(client, room_id, master) == before


async def test_another_rooms_tag_cannot_be_used(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A foreign Tag is 422 whether single or inside a combination, and the
    other Room is untouched."""
    master, _, room_id, ids = await _room(make_token, client)
    other, _, other_room, other_ids = await _room(make_token, client)
    before = await _get(client, other_room, other)

    for bad in ([[other_ids["NPC"]]], [[ids["NPC"], other_ids["NPC"]]]):
        assert (await _put(client, room_id, master, bad)).status_code == 422

    assert await _get(client, other_room, other) == before


async def _delete_tag(
    client: AsyncClient, room_id: str, headers: dict[str, str], tag_id: str
) -> Response:
    return await client.delete(f"/rooms/{room_id}/tags/{tag_id}", headers=headers)


async def test_deleting_a_tag_removes_its_main_item_and_keeps_documents(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 13: the Tag and its link go, the Document stays."""
    master, _, room_id, ids = await _room(make_token, client)
    document = (
        await client.post(
            f"/rooms/{room_id}/documents",
            json={"name": "Strahd", "tag_ids": [ids["NPC"], ids["Place"]]},
            headers=master,
        )
    ).json()

    response = await _delete_tag(client, room_id, master, ids["NPC"])

    assert response.status_code == 204
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    assert ids["NPC"] not in {t["id"] for t in tags}
    assert [ids["NPC"]] not in await _get(client, room_id, master)
    reloaded = (
        await client.get(f"/rooms/{room_id}/documents/{document['id']}", headers=master)
    ).json()
    assert reloaded["tag_ids"] == [ids["Place"]]


async def test_a_combination_shrinks_or_disappears_with_its_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Three Tags shrink to two; two Tags would leave one, so it is dropped."""
    master, _, room_id, ids = await _room(make_token, client)
    npc, place, event, pc = ids["NPC"], ids["Place"], ids["Event"], ids["PC"]
    await _put(client, room_id, master, [[npc, place, event], [place, pc], [npc]])

    await _delete_tag(client, room_id, master, event)
    assert await _get(client, room_id, master) == [[npc, place], [place, pc], [npc]]

    await _delete_tag(client, room_id, master, pc)
    assert await _get(client, room_id, master) == [[npc, place], [npc]]


async def test_a_shrunken_combination_that_duplicates_another_is_dropped(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """The earlier position wins; the saved items stay valid."""
    master, _, room_id, ids = await _room(make_token, client)
    npc, place, event = ids["NPC"], ids["Place"], ids["Event"]
    await _put(client, room_id, master, [[npc, place, event], [npc, place]])

    await _delete_tag(client, room_id, master, event)

    assert await _get(client, room_id, master) == [[npc, place]]
    # Saving what the API returned is accepted, so nothing invalid was stored.
    assert (await _put(client, room_id, master, [[npc, place]])).status_code == 200


async def test_the_master_may_delete_a_tag_without_being_an_administrator(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Same people who may create one (spec 13)."""
    admin, player, room_id, ids = await _room(make_token, client)
    members = (await client.get(f"/rooms/{room_id}/members", headers=admin)).json()
    player_id = next(m["user_id"] for m in members if not m["is_admin"])
    await client.patch(
        f"/rooms/{room_id}/members/{player_id}", json={"role": "master"}, headers=admin
    )

    response = await _delete_tag(client, room_id, player, ids["Event"])

    assert response.status_code == 204


async def test_a_player_cannot_delete_a_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """403, and the Tag is still there."""
    master, player, room_id, ids = await _room(make_token, client)

    response = await _delete_tag(client, room_id, player, ids["Event"])

    assert response.status_code == 403
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    assert ids["Event"] in {t["id"] for t in tags}


async def test_a_non_member_cannot_delete_a_tag(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """403 for someone outside the Room."""
    _, _, room_id, ids = await _room(make_token, client)
    stranger = _auth_headers(make_token(str(uuid.uuid4())))

    assert (await _delete_tag(client, room_id, stranger, ids["Event"])).status_code == 403


async def test_another_rooms_tag_cannot_be_deleted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """404, and the other Room keeps its Tag."""
    master, _, room_id, _ = await _room(make_token, client)
    other_master, _, other_room, other_ids = await _room(make_token, client)

    response = await _delete_tag(client, room_id, master, other_ids["Event"])

    assert response.status_code == 404
    other_tags = (await client.get(f"/rooms/{other_room}/tags", headers=other_master)).json()
    assert other_ids["Event"] in {t["id"] for t in other_tags}
    assert (await _delete_tag(client, room_id, master, str(uuid.uuid4()))).status_code == 404
