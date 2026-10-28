"""Session 0's DDI module (spec 47_3): the Room's Document the Players
read and accept, the template it can start from, and who sees what."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_zero_ddi_repo
from app.domain.session_zero_ddi import ddi_template
from app.main import app
from app.realtime.broker import broker


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@dataclass
class _Member:
    id: str
    headers: dict[str, str]


@dataclass
class _Room:
    id: str
    master: _Member
    player: _Member
    other_player: _Member

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}/session-zero"


def _new_member(make_token: Callable[..., str], language: str = "en") -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(
        id=user_id,
        headers={"Authorization": f"Bearer {make_token(user_id)}", "Accept-Language": language},
    )


async def _join(client: AsyncClient, room_id: str, master: _Member, member: _Member) -> None:
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    response = await client.post(f"/invitations/{invite['code']}/accept", headers=member.headers)
    assert response.status_code in (200, 201), response.text


async def _room(
    client: AsyncClient, make_token: Callable[..., str], *kinds: str, language: str = "en"
) -> tuple[_Room, Any]:
    """A Room of a Master and two Players whose Session 0 is a chain of
    `kinds`, on its first step; the Master's view of it."""
    master = _new_member(make_token, language)
    created = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    room = _Room(created["id"], master, _new_member(make_token), _new_member(make_token))
    await _join(client, room.id, master, room.player)
    await _join(client, room.id, master, room.other_player)
    started = await client.post(
        f"{room.url}/start", json={"modules": list(kinds)}, headers=master.headers
    )
    assert started.status_code == 200, started.text
    return room, started.json()


def _ddi(board: Any, index: int = 0) -> Any:
    module = [m for m in board["modules"] if m["kind"] == "ddi"][index]
    return {"id": module["id"], **module["ddi"]}


async def _get(client: AsyncClient, room: _Room, member: _Member) -> Any:
    response = await client.get(room.url, headers=member.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _new_document(
    client: AsyncClient, room: _Room, visibility: str = "room", name: str = "Our DDI"
) -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": name, "description": "We play on Fridays.", "visibility": visibility},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _set_document(
    client: AsyncClient, room: _Room, module_id: str, document_id: str | None
) -> Any:
    response = await client.put(
        f"{room.url}/modules/{module_id}/document",
        json={"document_id": document_id},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _accept(client: AsyncClient, room: _Room, member: _Member, module_id: str) -> Any:
    response = await client.post(
        f"{room.url}/modules/{module_id}/acceptance", headers=member.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_ddi_module_starts_without_a_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _room(client, make_token, "ddi")
    ddi = _ddi(board)
    assert ddi == ddi | {
        "document_id": None,
        "document_hidden": False,
        "changed_at": None,
        "acceptances": [],
        "can_accept": False,
    }
    player = _ddi(await _get(client, room, room.player))
    assert player["can_accept"] is False
    refused = await client.post(
        f"{room.url}/modules/{ddi['id']}/acceptance", headers=room.player.headers
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "The Master hasn't picked the DDI's Document yet."


async def test_the_master_picks_the_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 8: the Master picks one of the Room's Documents; a Player
    can't, another Room's is refused, another kind of module too."""
    room, board = await _room(client, make_token, "ddi", "retro")
    module_id = _ddi(board)["id"]
    document_id = await _new_document(client, room)
    ddi = _ddi(await _set_document(client, room, module_id, document_id))
    assert ddi["document_id"] == document_id
    assert ddi["changed_at"] is not None

    url = f"{room.url}/modules/{module_id}/document"
    by_player = await client.put(
        url, json={"document_id": document_id}, headers=room.player.headers
    )
    assert by_player.status_code == 403
    other_room, _ = await _room(client, make_token, "retro")
    foreign = await _new_document(client, other_room)
    for bad in (foreign, str(uuid.uuid4())):
        refused = await client.put(url, json={"document_id": bad}, headers=room.master.headers)
        assert refused.status_code == 422, refused.text
    retro = next(m["id"] for m in board["modules"] if m["kind"] == "retro")
    wrong_kind = await client.put(
        f"{room.url}/modules/{retro}/document",
        json={"document_id": document_id},
        headers=room.master.headers,
    )
    assert wrong_kind.status_code == 422
    not_ddi = await client.delete(
        f"{room.url}/modules/{retro}/acceptance", headers=room.master.headers
    )
    assert not_ddi.status_code == 422
    # Picking the same one again changes nothing; none clears it.
    _ddi(await _set_document(client, room, module_id, document_id))
    assert _ddi(await _set_document(client, room, module_id, None))["document_id"] is None


async def test_players_accept_and_the_master_sees_who_did(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 8: each Player accepts; the Master sees every acceptance,
    a Player only theirs; a change to the Document makes it out of date."""
    room, board = await _room(client, make_token, "ddi")
    module_id = _ddi(board)["id"]
    document_id = await _new_document(client, room)
    await _set_document(client, room, module_id, document_id)

    assert _ddi(await _get(client, room, room.player))["can_accept"] is True
    mine = _ddi(await _accept(client, room, room.player, module_id))
    assert mine["can_accept"] is False
    assert [(a["user_id"], a["outdated"], a["mine"]) for a in mine["acceptances"]] == [
        (room.player.id, False, True)
    ]
    other = _ddi(await _get(client, room, room.other_player))
    assert other["acceptances"] == [] and other["can_accept"] is True
    master = _ddi(await _get(client, room, room.master))
    assert [a["user_id"] for a in master["acceptances"]] == [room.player.id]
    assert master["acceptances"][0]["mine"] is False and master["can_accept"] is False
    by_master = await client.post(
        f"{room.url}/modules/{module_id}/acceptance", headers=room.master.headers
    )
    assert by_master.status_code == 403

    # The Document changes: the acceptance is out of date, and can be given again.
    edited = await client.patch(
        f"/rooms/{room.id}/documents/{document_id}",
        json={"description": "We play on Saturdays."},
        headers=room.master.headers,
    )
    assert edited.status_code == 200, edited.text
    changed = _ddi(await _get(client, room, room.player))
    assert changed["acceptances"][0]["outdated"] is True and changed["can_accept"] is True
    again = _ddi(await _accept(client, room, room.player, module_id))
    assert again["acceptances"][0]["outdated"] is False

    # Withdrawn, then nothing more to withdraw.
    url = f"{room.url}/modules/{module_id}/acceptance"
    withdrawn = await client.delete(url, headers=room.player.headers)
    assert withdrawn.status_code == 200 and _ddi(withdrawn.json())["acceptances"] == []
    assert (await client.delete(url, headers=room.player.headers)).status_code == 200

    # Another Document clears every acceptance.
    await _accept(client, room, room.player, module_id)
    other_document = await _new_document(client, room, name="New DDI")
    ddi = _ddi(await _set_document(client, room, module_id, other_document))
    assert ddi["acceptances"] == []


async def test_a_hidden_document_is_not_shown_nor_accepted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 8, D-08: the Document keeps its own visibility; a Player who
    doesn't see it learns only that there is one."""
    room, board = await _room(client, make_token, "ddi")
    module_id = _ddi(board)["id"]
    document_id = await _new_document(client, room, visibility="master")
    await _set_document(client, room, module_id, document_id)
    player = _ddi(await _get(client, room, room.player))
    assert player == player | {
        "document_id": None,
        "document_hidden": True,
        "changed_at": None,
        "can_accept": False,
    }
    refused = await client.post(
        f"{room.url}/modules/{module_id}/acceptance", headers=room.player.headers
    )
    assert refused.status_code == 404
    # Deleted, the module has no Document again.
    deleted = await client.delete(
        f"/rooms/{room.id}/documents/{document_id}", headers=room.master.headers
    )
    assert deleted.status_code == 204
    assert _ddi(await _get(client, room, room.master))["document_id"] is None


async def test_the_master_makes_the_ddi_from_the_template(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 8a: a new Document named and headed in the Master's
    language, the checklist and the credit in Italian, at the Room's
    default visibility, the Master its Owner."""
    room, board = await _room(client, make_token, "ddi", language="it")
    module_id = _ddi(board)["id"]
    url = f"{room.url}/modules/{module_id}/document/template"
    assert (await client.post(url, headers=room.player.headers)).status_code == 403
    made = await client.post(url, headers=room.master.headers)
    assert made.status_code == 200, made.text
    document_id = _ddi(made.json())["document_id"]
    response = await client.get(
        f"/rooms/{room.id}/documents/{document_id}", headers=room.master.headers
    )
    document = response.json()
    assert document["name"] == "Dichiarazione d'Intenti"
    assert document["visibility"] == "room"
    assert document["description"].startswith("## Dietro il Tavolo\n\n*L'ossatura")
    assert "### Personaggi\n\n- Obiettivi:" in document["description"]
    assert document["description"].endswith('Riccardo "Musta" Caverni.*')
    assert _ddi(await _get(client, room, room.player))["can_accept"] is True


def test_the_template_heads_its_sections_in_the_language_given() -> None:
    template = ddi_template(lambda key: key.upper())
    assert template.startswith("## BEHIND\n\n*BEHINDHINT*\n\n### MEETING\n\n- Beer-first")
    assert template.count("\n## ") == 1 and template.count("### ") == 6


async def test_the_ddi_follows_the_chain(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A Player can't accept a step not reached yet (404) nor in a closed
    session (409); a new session's DDI carries the Document over when asked
    (spec 47b), not the acceptances; a DDI added later starts empty."""
    room, board = await _room(client, make_token, "retro", "ddi")
    module_id = _ddi(board)["id"]
    document_id = await _new_document(client, room)
    await _set_document(client, room, module_id, document_id)
    url = f"{room.url}/modules/{module_id}/acceptance"
    assert (await client.post(url, headers=room.player.headers)).status_code == 404
    await client.put(
        f"{room.url}/modules/current", json={"module_id": module_id}, headers=room.master.headers
    )
    await _accept(client, room, room.player, module_id)

    fresh = await client.post(
        f"{room.url}/rounds",
        json={"modules": ["retro", {"kind": "ddi", "carry": True}]},
        headers=room.master.headers,
    )
    assert fresh.status_code == 200, fresh.text
    copied = _ddi(fresh.json())
    assert copied["document_id"] == document_id and copied["acceptances"] == []
    assert (await client.post(url, headers=room.player.headers)).status_code == 409

    added = await client.post(
        f"{room.url}/modules", json={"kind": "ddi"}, headers=room.master.headers
    )
    assert _ddi(added.json(), 1)["document_id"] is None
    composed = await client.post(
        f"{room.url}/rounds",
        json={"modules": [{"kind": "ddi", "carry": True}, "ddi", "ddi"]},
        headers=room.master.headers,
    )
    chain = [_ddi(composed.json(), i)["document_id"] for i in range(3)]
    assert chain == [document_id, None, None]


async def test_acceptances_reach_only_their_readers_streams(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 12: an acceptance's event goes to the Player and the Master."""
    room, board = await _room(client, make_token, "ddi")
    module_id = _ddi(board)["id"]
    await _set_document(client, room, module_id, await _new_document(client, room))
    room_id = uuid.UUID(room.id)
    streams = {
        member.id: broker.subscribe(room_id, uuid.UUID(member.id))
        for member in (room.master, room.player, room.other_player)
    }
    try:
        await _accept(client, room, room.player, module_id)
        heard = {user: not stream.queue.empty() for user, stream in streams.items()}
        assert heard == {room.master.id: True, room.player.id: True, room.other_player.id: False}
        event = streams[room.player.id].queue.get_nowait()
        assert event is not None and event.kind == "accept"
    finally:
        for stream in streams.values():
            broker.unsubscribe(stream)


async def test_acceptances_are_in_the_export_and_go_with_the_account(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 47 Decision 14, spec 31."""
    room, board = await _room(client, make_token, "ddi")
    module_id = _ddi(board)["id"]
    await _set_document(client, room, module_id, await _new_document(client, room))
    await _accept(client, room, room.player, module_id)
    export = await client.get("/account/export", headers=room.player.headers)
    assert export.status_code == 200, export.text
    assert [a["room_id"] for a in export.json()["acceptances"]] == [room.id]
    assert await session_zero_ddi_repo.list_acceptances(db_session, []) == []
