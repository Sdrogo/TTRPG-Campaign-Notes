"""Session 0's Questions module (spec 47_2): the Master's questions, the
Players' answers and who reads them, and the Documents made from them."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_zero_questions_repo
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


def _new_member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(
        id=user_id,
        headers={"Authorization": f"Bearer {make_token(user_id)}", "Accept-Language": "en"},
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
    client: AsyncClient, make_token: Callable[..., str], *kinds: str
) -> tuple[_Room, Any]:
    """A Room of a Master and two Players whose Session 0 is a chain of
    `kinds`, on its first step; the Master's view of it."""
    master = _new_member(make_token)
    created = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    room = _Room(created["id"], master, _new_member(make_token), _new_member(make_token))
    await _join(client, room.id, master, room.player)
    await _join(client, room.id, master, room.other_player)
    started = await client.post(
        f"{room.url}/start", json={"modules": list(kinds)}, headers=master.headers
    )
    assert started.status_code == 200, started.text
    return room, started.json()


def _questions(board: Any, index: int = 0) -> Any:
    module = [m for m in board["modules"] if m["kind"] == "questions"][index]
    return {"id": module["id"], **module["questions"]}


async def _get(client: AsyncClient, room: _Room, member: _Member) -> Any:
    response = await client.get(room.url, headers=member.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _tags(client: AsyncClient, room: _Room) -> dict[str, str]:
    response = await client.get(f"/rooms/{room.id}/tags", headers=room.master.headers)
    return {tag["name"]: tag["id"] for tag in response.json()}


async def _set_questions(
    client: AsyncClient, room: _Room, module_id: str, questions: list[dict[str, Any]]
) -> Any:
    response = await client.put(
        f"{room.url}/modules/{module_id}/questions",
        json={"questions": questions},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _answer(
    client: AsyncClient,
    room: _Room,
    member: _Member,
    module_id: str,
    answers: list[dict[str, Any]],
) -> Any:
    response = await client.put(
        f"{room.url}/modules/{module_id}/answers", json={"answers": answers}, headers=member.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _document(client: AsyncClient, room: _Room, member: _Member, document_id: str) -> Any:
    response = await client.get(f"/rooms/{room.id}/documents/{document_id}", headers=member.headers)
    assert response.status_code == 200, response.text
    return response.json()


# The PC questionnaire used across these tests.
PC_QUESTIONS = [
    {"body": "What's your character called?", "target": "name"},
    {"body": "In one line?", "target": "subtitle"},
    {"body": "Where do you come from?", "hint": "A place, a people", "target": "description"},
    {"body": "What do you fear?", "target": "description"},
    {"body": "A secret", "target": "note"},
    {"body": "Something everyone knows", "target": "note"},
    {"body": "Name an NPC tied to you", "target": "document"},
    {"body": "Favourite snack at the table", "target": "none"},
]


async def _with_questions(
    client: AsyncClient, make_token: Callable[..., str], *kinds: str
) -> tuple[_Room, Any]:
    room, board = await _room(client, make_token, *(kinds or ("questions",)))
    tags = await _tags(client, room)
    questions = [dict(q) for q in PC_QUESTIONS]
    questions[6]["tag_id"] = tags["NPC"]
    board = await _set_questions(client, room, _questions(board)["id"], questions)
    return room, _questions(board)


async def test_a_questions_module_starts_with_the_pc_tag_and_no_questions(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 9: a new Questions module tags its Documents `PC` and lets
    Players create theirs (Q7); the Master writes the list."""
    room, board = await _room(client, make_token, "questions", "retro")
    tags = await _tags(client, room)
    module = _questions(board)
    assert module["tag_id"] == tags["PC"]
    assert module["players_bypass_creation_rule"] is True
    assert module["answers_revealed"] is False
    assert module["questions"] == [] and module["answers"] == []
    assert module["can_create"] is False and module["creatable"] == 0

    # Added later, too; without a `PC` Tag in the Room it gets none.
    await client.delete(f"/rooms/{room.id}/tags/{tags['PC']}", headers=room.master.headers)
    added = await client.post(
        f"{room.url}/modules", json={"kind": "questions"}, headers=room.master.headers
    )
    assert _questions(added.json(), 1)["tag_id"] is None
    # Retro steps have no questions.
    assert next(m for m in board["modules"] if m["kind"] == "retro")["questions"] is None


async def test_the_master_writes_the_questions(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 9: the whole list at once, in order; ids keep a question and
    its answers, those left out go; the mapping rules hold."""
    room, module = await _with_questions(client, make_token)
    tags = await _tags(client, room)
    questions = module["questions"]
    assert [q["target"] for q in questions] == [q["target"] for q in PC_QUESTIONS]
    assert questions[2]["hint"] == "A place, a people"
    assert questions[6]["tag_id"] == tags["NPC"]
    assert [q["position"] for q in questions] == list(range(len(PC_QUESTIONS)))

    await _answer(
        client,
        room,
        room.player,
        module["id"],
        [{"question_id": questions[3]["id"], "body": "Rats"}],
    )
    # Reordered and trimmed: the fear question keeps its answer, the snack one goes.
    kept = [questions[3], questions[0]]
    await _set_questions(
        client,
        room,
        module["id"],
        [
            {"id": kept[0]["id"], "body": "  What do   you fear? ", "target": "description"},
            # A Tag on anything but a "New Document" question is dropped.
            {"id": kept[1]["id"], "body": "Name", "target": "name", "tag_id": tags["NPC"]},
        ],
    )
    master = _questions(await _get(client, room, room.master))
    assert [(q["id"], q["body"], q["tag_id"]) for q in master["questions"]] == [
        (kept[0]["id"], "What do you fear?", None),
        (kept[1]["id"], "Name", None),
    ]
    assert [a["body"] for a in master["answers"]] == ["Rats"]

    url = f"{room.url}/modules/{module['id']}/questions"
    bad_lists: list[list[dict[str, Any]]] = [
        [{"body": "Who?", "target": "description"}],
        [{"body": "A", "target": "name"}, {"body": "B", "target": "name"}],
        [
            {"body": "A", "target": "name"},
            {"body": "B", "target": "subtitle"},
            {"body": "C", "target": "subtitle"},
        ],
        [{"body": "A", "target": "name"}]
        + [{"body": f"D{i}", "target": "document"} for i in range(6)],
        [{"body": "A", "target": "name"}] + [{"body": "?", "target": "none"}] * 30,
        [{"body": "   ", "target": "name"}],
        [{"body": "x" * 201, "target": "name"}],
        [{"body": "A", "target": "name", "hint": "h" * 301}],
        [{"id": str(uuid.uuid4()), "body": "A", "target": "name"}],
        [
            {"id": kept[1]["id"], "body": "A", "target": "name"},
            {"id": kept[1]["id"], "body": "B", "target": "none"},
        ],
        [
            {"body": "A", "target": "name"},
            {"body": "B", "target": "document", "tag_id": str(uuid.uuid4())},
        ],
    ]
    for questions_list in bad_lists:
        bad = await client.put(url, json={"questions": questions_list}, headers=room.master.headers)
        assert bad.status_code == 422, (questions_list, bad.text)
    refused = await client.put(
        url, json={"questions": [{"body": "A", "target": "name"}]}, headers=room.player.headers
    )
    assert refused.status_code == 403
    # An empty list is fine (nothing to answer yet).
    assert _questions(await _set_questions(client, room, module["id"], []))["questions"] == []


async def test_the_module_settings_are_the_masters(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decisions 9 and 11: the Tag of the Documents and the D-13 exception."""
    room, module = await _with_questions(client, make_token)
    tags = await _tags(client, room)
    url = f"{room.url}/modules/{module['id']}"
    changed = await client.patch(
        url,
        json={"tag_id": tags["NPC"], "players_bypass_creation_rule": False},
        headers=room.master.headers,
    )
    assert changed.status_code == 200, changed.text
    assert _questions(changed.json())["tag_id"] == tags["NPC"]
    assert _questions(changed.json())["players_bypass_creation_rule"] is False
    cleared = await client.patch(url, json={"tag_id": None}, headers=room.master.headers)
    assert _questions(cleared.json())["tag_id"] is None
    assert _questions(cleared.json())["players_bypass_creation_rule"] is False
    unchanged = await client.patch(url, json={}, headers=room.master.headers)
    assert unchanged.status_code == 200
    assert (
        await client.patch(url, json={"tag_id": str(uuid.uuid4())}, headers=room.master.headers)
    ).status_code == 422
    assert (await client.patch(url, json={}, headers=room.player.headers)).status_code == 403

    # Only a Questions module has these settings.
    board = await _get(client, room, room.master)
    retro_room, retro_board = await _room(client, make_token, "retro")
    not_questions = await client.patch(
        f"{retro_room.url}/modules/{retro_board['modules'][0]['id']}",
        json={},
        headers=retro_room.master.headers,
    )
    assert not_questions.status_code == 422
    assert board["modules"][0]["kind"] == "questions"


async def test_answers_are_their_authors_and_the_masters_until_revealed(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 10, Q2: Players answer, each sees only their own; the Master
    sees all; once revealed, everyone does, read-only for the others."""
    room, module = await _with_questions(client, make_token)
    questions = module["questions"]
    name, note = questions[0]["id"], questions[4]["id"]
    mine = await _answer(
        client,
        room,
        room.player,
        module["id"],
        [
            {"question_id": name, "body": "  Ireena\n Kolyana  "},
            {"question_id": note, "body": "  I am a vampire's bride\n", "note_private": True},
            # Private only means something on a Note answer.
            {"question_id": questions[2]["id"], "body": "Barovia", "note_private": True},
        ],
    )
    answers = {a["question_id"]: a for a in _questions(mine)["answers"]}
    assert answers[name]["body"] == "Ireena Kolyana"
    assert answers[note] == answers[note] | {"body": "I am a vampire's bride", "note_private": True}
    assert answers[questions[2]["id"]]["note_private"] is False
    await _answer(
        client, room, room.other_player, module["id"], [{"question_id": name, "body": "Ismark"}]
    )

    other = _questions(await _get(client, room, room.other_player))
    assert [a["body"] for a in other["answers"]] == ["Ismark"]
    master = _questions(await _get(client, room, room.master))
    assert len(master["answers"]) == 4

    # An empty answer deletes it.
    cleared = await _answer(
        client, room, room.player, module["id"], [{"question_id": questions[2]["id"], "body": " "}]
    )
    assert len(_questions(cleared)["answers"]) == 2
    # Nothing to save changes nothing.
    await _answer(client, room, room.player, module["id"], [])

    url = f"{room.url}/modules/{module['id']}"
    for body, status in (
        ({"answers": [{"question_id": str(uuid.uuid4()), "body": "?"}]}, 422),
        ({"answers": [{"question_id": name, "body": "x" * 201}]}, 422),
        ({"answers": [{"question_id": questions[1]["id"], "body": "x" * 121}]}, 422),
        ({"answers": [{"question_id": note, "body": "x" * 2001}]}, 422),
    ):
        bad = await client.put(f"{url}/answers", json=body, headers=room.player.headers)
        assert bad.status_code == status, bad.text
    master_answer = await client.put(
        f"{url}/answers",
        json={"answers": [{"question_id": name, "body": "Strahd"}]},
        headers=room.master.headers,
    )
    assert master_answer.status_code == 403

    # Revealed: every member reads every answer; hidden again: back to before.
    assert (
        await client.put(f"{url}/reveal", json={"revealed": True}, headers=room.player.headers)
    ).status_code == 403
    revealed = await client.put(
        f"{url}/reveal", json={"revealed": True}, headers=room.master.headers
    )
    assert _questions(revealed.json())["answers_revealed"] is True
    other = _questions(await _get(client, room, room.other_player))
    assert len(other["answers"]) == 3
    # Saving a revealed answer is news for everyone; revealing twice changes nothing.
    await _answer(
        client,
        room,
        room.other_player,
        module["id"],
        [{"question_id": name, "body": "Ismark the Lesser"}],
    )
    again = await client.put(f"{url}/reveal", json={"revealed": True}, headers=room.master.headers)
    assert again.status_code == 200
    await client.put(f"{url}/reveal", json={"revealed": False}, headers=room.master.headers)
    other = _questions(await _get(client, room, room.other_player))
    assert [a["body"] for a in other["answers"]] == ["Ismark the Lesser"]


async def test_a_player_makes_their_document_from_their_answers(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 11: name, subtitle, description sections, Notes (Private
    when asked), the module's Tag, Public, the Player its Owner and
    Character player; a "New Document" answer is a Document of its own;
    once only, again after it is deleted."""
    room, module = await _with_questions(client, make_token)
    tags = await _tags(client, room)
    q = [question["id"] for question in module["questions"]]
    url = f"{room.url}/modules/{module['id']}/documents"
    # No Name answer yet: nothing to make.
    assert (await client.post(url, headers=room.player.headers)).status_code == 409

    board = await _answer(
        client,
        room,
        room.player,
        module["id"],
        [
            {"question_id": q[0], "body": "Ireena Kolyana"},
            {"question_id": q[1], "body": "The burgomaster's daughter"},
            {"question_id": q[2], "body": "Barovia village"},
            {"question_id": q[4], "body": "Strahd wants me", "note_private": True},
            {"question_id": q[5], "body": "I am brave"},
            {"question_id": q[6], "body": "Ismark\nMy brother, the Lesser"},
            {"question_id": q[7], "body": "Garlic bread"},
        ],
    )
    assert _questions(board)["can_create"] is True
    made = await client.post(url, headers=room.player.headers)
    assert made.status_code == 200, made.text
    module_after = _questions(made.json())
    assert module_after["can_create"] is False
    links = {link["question_id"]: link["document_id"] for link in module_after["documents"]}
    assert set(links) == {None, q[6]}

    document = await _document(client, room, room.player, links[None])
    assert document["name"] == "Ireena Kolyana"
    assert document["subtitle"] == "The burgomaster's daughter"
    assert document["description"] == "## Where do you come from?\n\nBarovia village"
    assert document["visibility"] == "room"
    assert document["tag_ids"] == [tags["PC"]]
    assert document["owner_ids"] == [room.player.id]
    assert document["played_by"] == room.player.id
    assert [(n["title"], n["description"], n["visibility"]) for n in document["notes"]] == [
        ("A secret", "Strahd wants me", "private"),
        ("Something everyone knows", "I am brave", "room"),
    ]
    # The other Player doesn't see the Private Note, nor (unrevealed) the links.
    seen = await _document(client, room, room.other_player, links[None])
    assert [n["title"] for n in seen["notes"]] == ["Something everyone knows"]
    assert _questions(await _get(client, room, room.other_player))["documents"] == []

    npc = await _document(client, room, room.player, links[q[6]])
    assert (npc["name"], npc["description"]) == ("Ismark", "My brother, the Lesser")
    assert npc["tag_ids"] == [tags["NPC"]] and npc["owner_ids"] == [room.player.id]
    assert npc["played_by"] is None

    assert (await client.post(url, headers=room.player.headers)).status_code == 409
    assert (await client.post(url, headers=room.master.headers)).status_code == 403

    # Deleted, it can be made again; the NPC already made isn't made twice.
    deleted = await client.delete(
        f"/rooms/{room.id}/documents/{links[None]}", headers=room.player.headers
    )
    assert deleted.status_code == 204
    again = await client.post(url, headers=room.player.headers)
    assert again.status_code == 200, again.text
    assert len(_questions(again.json())["documents"]) == 2


async def test_a_document_with_only_a_name(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Unanswered questions add nothing; no Tag when the module has none."""
    room, board = await _room(client, make_token, "questions")
    module_id = _questions(board)["id"]
    await client.patch(
        f"{room.url}/modules/{module_id}", json={"tag_id": None}, headers=room.master.headers
    )
    board = await _set_questions(
        client,
        room,
        module_id,
        [{"body": "Name", "target": "name"}, {"body": "NPC", "target": "document"}],
    )
    name, npc = (q["id"] for q in _questions(board)["questions"])
    await _answer(
        client,
        room,
        room.player,
        module_id,
        [{"question_id": name, "body": "Rahadin"}, {"question_id": npc, "body": "Strahd"}],
    )
    made = (
        await client.post(f"{room.url}/modules/{module_id}/documents", headers=room.player.headers)
    ).json()
    links = {link["question_id"]: link["document_id"] for link in _questions(made)["documents"]}
    document = await _document(client, room, room.player, links[None])
    assert (
        document["subtitle"],
        document["description"],
        document["tag_ids"],
        document["notes"],
    ) == (None, "", [], [])
    extra = await _document(client, room, room.player, links[npc])
    assert (extra["name"], extra["description"], extra["tag_ids"]) == ("Strahd", "", [])


async def test_creation_follows_the_room_unless_the_module_makes_an_exception(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Q7: with D-13 off, Players still create theirs while the module's
    switch is on (its default); off, only the Master's "everyone" works,
    and it makes the Player Owner and Character player all the same."""
    room, module = await _with_questions(client, make_token)
    name = module["questions"][0]["id"]
    await client.patch(
        f"/rooms/{room.id}",
        json={"players_can_create_documents": False},
        headers=room.master.headers,
    )
    for player in (room.player, room.other_player):
        await _answer(
            client,
            room,
            player,
            module["id"],
            [{"question_id": name, "body": f"PC of {player.id[:4]}"}],
        )
    url = f"{room.url}/modules/{module['id']}"

    board = await _get(client, room, room.player)
    assert _questions(board)["can_create"] is True
    made = await client.post(f"{url}/documents", headers=room.player.headers)
    assert made.status_code == 200, made.text

    await client.patch(
        url, json={"players_bypass_creation_rule": False}, headers=room.master.headers
    )
    assert _questions(await _get(client, room, room.other_player))["can_create"] is False
    refused = await client.post(f"{url}/documents", headers=room.other_player.headers)
    assert refused.status_code == 403

    master = _questions(await _get(client, room, room.master))
    assert master["creatable"] == 1
    assert (
        await client.post(f"{url}/documents/all", headers=room.player.headers)
    ).status_code == 403
    everyone = await client.post(f"{url}/documents/all", headers=room.master.headers)
    assert everyone.status_code == 200, everyone.text
    module_after = _questions(everyone.json())
    assert module_after["creatable"] == 0
    theirs = next(
        link["document_id"]
        for link in module_after["documents"]
        if link["user_id"] == room.other_player.id and link["question_id"] is None
    )
    document = await _document(client, room, room.master, theirs)
    assert document["owner_ids"] == [room.other_player.id]
    assert document["played_by"] == room.other_player.id
    # Nobody left: nothing happens.
    nothing = await client.post(f"{url}/documents/all", headers=room.master.headers)
    assert nothing.status_code == 200
    # Revealed, every member sees which Documents were made.
    await client.put(f"{url}/reveal", json={"revealed": True}, headers=room.master.headers)
    assert len(_questions(await _get(client, room, room.player))["documents"]) == 2


async def test_questions_follow_the_chain_rules(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 5: a Questions step not reached yet is 404 to a Player;
    Decision 2: a new session copies the questions, not the answers, and
    the closed one is read-only."""
    room, board = await _room(client, make_token, "retro", "questions")
    module_id = _questions(board)["id"]
    board = await _set_questions(client, room, module_id, [{"body": "Name", "target": "name"}])
    name = _questions(board)["questions"][0]["id"]
    hidden = await client.put(
        f"{room.url}/modules/{module_id}/answers",
        json={"answers": [{"question_id": name, "body": "Ezmerelda"}]},
        headers=room.player.headers,
    )
    assert hidden.status_code == 404
    await client.put(
        f"{room.url}/modules/current", json={"module_id": module_id}, headers=room.master.headers
    )
    await _answer(
        client, room, room.player, module_id, [{"question_id": name, "body": "Ezmerelda"}]
    )
    tags = await _tags(client, room)
    await client.patch(
        f"{room.url}/modules/{module_id}",
        json={"tag_id": tags["NPC"], "players_bypass_creation_rule": False},
        headers=room.master.headers,
    )

    next_session = await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)
    assert next_session.status_code == 200, next_session.text
    copied = _questions(next_session.json())
    assert copied["id"] != module_id
    assert [q["body"] for q in copied["questions"]] == ["Name"]
    assert copied["questions"][0]["id"] != name
    assert copied["answers"] == []
    assert (copied["tag_id"], copied["players_bypass_creation_rule"]) == (tags["NPC"], False)

    # The closed session's step is read-only and makes no Documents.
    closed = await client.put(
        f"{room.url}/modules/{module_id}/answers",
        json={"answers": [{"question_id": name, "body": "Van Richten"}]},
        headers=room.player.headers,
    )
    assert closed.status_code == 409
    old_round = next_session.json()["rounds"][0]["id"]
    old = await client.get(room.url, params={"round_id": old_round}, headers=room.player.headers)
    old_module = _questions(old.json())
    assert old_module["can_create"] is False
    assert [a["body"] for a in old_module["answers"]] == ["Ezmerelda"]
    master_old = await client.get(
        room.url, params={"round_id": old_round}, headers=room.master.headers
    )
    assert _questions(master_old.json())["creatable"] == 0

    # A chain composed anew gets fresh Questions modules.
    fresh = await client.post(
        f"{room.url}/rounds",
        json={"modules": ["questions", "questions"]},
        headers=room.master.headers,
    )
    second = _questions(fresh.json(), 1)
    assert second["questions"] == [] and second["tag_id"] == tags["PC"]


async def test_answers_reach_only_their_readers_streams(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 12: an unrevealed answer's event goes to its author and the
    Master only, at the unchanged revision."""
    room, module = await _with_questions(client, make_token)
    room_id = uuid.UUID(room.id)
    streams = {
        member.id: broker.subscribe(room_id, uuid.UUID(member.id))
        for member in (room.master, room.player, room.other_player)
    }
    try:
        await _answer(
            client,
            room,
            room.player,
            module["id"],
            [{"question_id": module["questions"][0]["id"], "body": "Ireena"}],
        )
        heard = {user: not stream.queue.empty() for user, stream in streams.items()}
        assert heard == {room.master.id: True, room.player.id: True, room.other_player.id: False}
        event = streams[room.player.id].queue.get_nowait()
        assert event is not None and event.kind == "answer"
    finally:
        for stream in streams.values():
            broker.unsubscribe(stream)


async def test_no_modules_read_no_rows(db_session: AsyncSession) -> None:
    assert await session_zero_questions_repo.list_questions(db_session, []) == []
    assert await session_zero_questions_repo.list_answer_documents(db_session, []) == []
