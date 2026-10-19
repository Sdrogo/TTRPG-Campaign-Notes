"""Generated mentions (spec 39): proposals on one Document and on the whole
Room, only from names the caller sees and in text they manage, and applying
the chosen ones as an edit would."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

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


@dataclass
class _Room:
    """A Room with a Master and a Player, and its base URL."""

    url: str
    master: dict[str, str]
    player: dict[str, str]
    player_id: str


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master_id, player_id = str(uuid.uuid4()), str(uuid.uuid4())
    master = _headers(make_token, master_id)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player = _headers(make_token, player_id)
    joined = await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    assert joined.status_code in (200, 201)
    return _Room(f"/rooms/{room['id']}", master, player, player_id)


async def _document(
    client: AsyncClient, room: _Room, name: str, headers: dict[str, str], **fields: Any
) -> dict[str, Any]:
    created = await client.post(
        f"{room.url}/documents", json={"name": name, **fields}, headers=headers
    )
    assert created.status_code == 201, created.text
    document: dict[str, Any] = created.json()
    return document


async def _get(client: AsyncClient, url: str, headers: dict[str, str]) -> dict[str, Any]:
    response = await client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _chosen(
    source: dict[str, Any], keep: Callable[[dict[str, Any]], bool] = lambda _: True
) -> dict[str, Any]:
    return {
        "document_id": source["document_id"],
        "note_id": source["note_id"],
        "matches": [
            {k: m[k] for k in ("start", "end", "kind", "target_id")}
            for m in source["matches"]
            if keep(m)
        ],
    }


async def _note(
    client: AsyncClient, room: _Room, document: dict[str, Any], description: str
) -> dict[str, Any]:
    created = await client.post(
        f"{room.url}/documents/{document['id']}/notes",
        json={"title": "Dopo", "description": description},
        headers=room.master,
    )
    assert created.status_code == 201, created.text
    note: dict[str, Any] = created.json()
    return note


async def test_a_document_proposes_names_in_its_description_and_notes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    # Written before the Documents it names exist, so nothing was linked on save.
    tale = await _document(
        client, room, "Racconto", room.master, description="Lyra entra nella locanda, a nord."
    )
    note = await _note(client, room, tale, "Poi Lyra dorme.")
    lyra = await _document(client, room, "Lyra", room.master)
    inn = await _document(client, room, "Locanda", room.master)
    await client.post(f"{room.url}/tags", json={"name": "Nord"}, headers=room.master)

    body = await _get(client, f"{room.url}/documents/{tale['id']}/mention-suggestions", room.master)

    description, in_note = body["sources"]
    assert (description["document_name"], description["note_id"]) == ("Racconto", None)
    # Tags are never proposed (product owner, 2026-10-19).
    assert [(m["text"], m["kind"], m["target_id"]) for m in description["matches"]] == [
        ("Lyra", "doc", lyra["id"]),
        ("locanda", "doc", inn["id"]),
    ]
    assert description["matches"][1]["before"] == "Lyra entra nella "
    assert description["matches"][1]["after"] == ", a nord."
    assert description["matches"][1]["target_name"] == "Locanda"
    assert (in_note["note_id"], in_note["note_title"]) == (note["id"], "Dopo")

    # The Player can't change the Document: 403, after a 404 for one they can't see.
    forbidden = await client.get(
        f"{room.url}/documents/{tale['id']}/mention-suggestions", headers=room.player
    )
    assert forbidden.status_code == 403
    hidden = await _document(client, room, "Segreto", room.master, visibility="master")
    missing = await client.get(
        f"{room.url}/documents/{hidden['id']}/mention-suggestions", headers=room.player
    )
    assert missing.status_code == 404


async def test_applying_links_only_the_chosen_matches_and_records_them(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tale = await _document(
        client, room, "Racconto", room.master, description="Lyra entra nella Locanda."
    )
    note = await _note(client, room, tale, "Poi Lyra dorme.")
    lyra = await _document(client, room, "Lyra", room.master)
    inn = await _document(client, room, "Locanda", room.master)
    url = f"{room.url}/documents/{tale['id']}/mention-suggestions"
    description, in_note = (await _get(client, url, room.master))["sources"]

    applied = await client.post(
        f"{room.url}/mention-suggestions/apply",
        json={
            "sources": [
                _chosen(description, lambda m: m["text"] == "Locanda"),
                _chosen(in_note),
                # The same text twice counts once; an empty choice changes nothing.
                {**_chosen(in_note), "matches": []},
            ]
        },
        headers=room.master,
    )

    assert applied.status_code == 200, applied.text
    assert applied.json() == {"applied": 2, "documents": 1}
    saved = await _get(client, f"{room.url}/documents/{tale['id']}", room.master)
    assert saved["description"] == f"Lyra entra nella #[Locanda](doc:{inn['id']})."
    assert saved["notes"][0]["description"] == f"Poi #[Lyra](doc:{lyra['id']}) dorme."
    backlinks = (
        await client.get(f"{room.url}/documents/{inn['id']}/backlinks", headers=room.master)
    ).json()
    assert [g["document_name"] for g in backlinks] == ["Racconto"]
    history = await _get(client, f"{room.url}/documents/{tale['id']}/versions", room.master)
    assert history  # the save is in the Document's history

    # What was linked is not proposed again; the preview is now stale.
    again = await _get(client, url, room.master)
    assert [m["text"] for m in again["sources"][0]["matches"]] == ["Lyra"]
    stale = await client.post(
        f"{room.url}/mention-suggestions/apply",
        json={"sources": [_chosen(description)]},
        headers=room.master,
    )
    assert stale.status_code == 409
    assert note["id"] == in_note["note_id"]


async def test_the_room_proposes_only_what_the_caller_sees_and_manages(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "Diario", room.master, description="Lyra e il Segreto.")
    own = await _document(
        client, room, "Appunti", room.player, description="Lyra cerca il Segreto."
    )
    await _document(client, room, "Segreto", room.master, visibility="master")
    await _document(client, room, "Lyra", room.master)

    for_player = await _get(client, f"{room.url}/mention-suggestions", room.player)
    for_master = await _get(client, f"{room.url}/mention-suggestions", room.master)

    assert [
        (s["document_name"], [m["text"] for m in s["matches"]]) for s in for_player["sources"]
    ] == [("Appunti", ["Lyra"])]
    assert [
        (s["document_name"], [m["text"] for m in s["matches"]]) for s in for_master["sources"]
    ] == [("Appunti", ["Lyra", "Segreto"]), ("Diario", ["Lyra", "Segreto"])]

    # The Player can't apply to the Master's Document, nor to a Note they can't see.
    diario = next(s for s in for_master["sources"] if s["document_name"] == "Diario")
    refused = await client.post(
        f"{room.url}/mention-suggestions/apply",
        json={"sources": [_chosen(diario)]},
        headers=room.player,
    )
    assert refused.status_code == 403
    no_note = await client.post(
        f"{room.url}/mention-suggestions/apply",
        json={"sources": [{"document_id": own["id"], "note_id": str(uuid.uuid4()), "matches": []}]},
        headers=room.player,
    )
    assert no_note.status_code == 404


async def test_choosing_nothing_changes_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    own = await _document(client, room, "Appunti", room.player, description="Lyra.")
    await _document(client, room, "Lyra", room.master)

    applied = await client.post(
        f"{room.url}/mention-suggestions/apply",
        json={"sources": [{"document_id": own["id"], "matches": []}]},
        headers=room.player,
    )

    assert applied.json() == {"applied": 0, "documents": 0}
    saved = await _get(client, f"{room.url}/documents/{own['id']}", room.player)
    assert saved["description"] == "Lyra."


async def test_a_save_links_the_document_names_it_adds(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    lyra = await _document(client, room, "Lyra", room.master)
    await _document(client, room, "Segreto", room.master, visibility="master")
    await client.post(f"{room.url}/tags", json={"name": "Nord"}, headers=room.master)

    # Created by the Player: Lyra links, the hidden Document and the Tag don't.
    own = await _document(
        client, room, "Appunti", room.player, description="Lyra, il Segreto e il Nord."
    )
    assert own["description"] == f"#[Lyra](doc:{lyra['id']}), il Segreto e il Nord."

    # Turned back into plain words, it stays plain; a new name typed in links.
    url = f"{room.url}/documents/{own['id']}"
    unlinked = await client.patch(url, json={"description": "Lyra, poi."}, headers=room.player)
    assert unlinked.json()["description"] == "Lyra, poi."
    added = await client.patch(url, json={"description": "Lyra, poi Lyra."}, headers=room.player)
    assert added.json()["description"] == f"Lyra, poi #[Lyra](doc:{lyra['id']})."

    # Notes too, created and edited; a Document's own name is never linked.
    tale = await _document(client, room, "Racconto", room.master)
    note = await _note(client, room, tale, "Racconto di Lyra.")
    assert note["description"] == f"Racconto di #[Lyra](doc:{lyra['id']})."
    edited = await client.patch(
        f"{room.url}/documents/{tale['id']}/notes/{note['id']}",
        json={"description": f"{note['description']} Lyra dorme."},
        headers=room.master,
    )
    assert edited.json()["description"] == (
        f"Racconto di #[Lyra](doc:{lyra['id']}). #[Lyra](doc:{lyra['id']}) dorme."
    )


async def test_a_repeated_match_counts_once_and_requests_are_bounded(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tale = await _document(client, room, "Racconto", room.master, description="Ecco Lyra.")
    lyra = await _document(client, room, "Lyra", room.master)
    (source,) = (
        await _get(client, f"{room.url}/documents/{tale['id']}/mention-suggestions", room.master)
    )["sources"]
    chosen = _chosen(source)
    chosen["matches"] *= 2
    apply_url = f"{room.url}/mention-suggestions/apply"

    applied = await client.post(apply_url, json={"sources": [chosen]}, headers=room.master)

    assert applied.json() == {"applied": 1, "documents": 1}
    saved = await _get(client, f"{room.url}/documents/{tale['id']}", room.master)
    assert saved["description"] == f"Ecco #[Lyra](doc:{lyra['id']})."

    too_many = {"document_id": tale["id"], "matches": []}
    refused = await client.post(apply_url, json={"sources": [too_many] * 501}, headers=room.master)
    assert refused.status_code == 422

    # Another Room's Document is not found (and never locked).
    other = await _room(client, make_token)
    foreign = await _document(client, other, "Altrove", other.master)
    missing = await client.post(
        apply_url,
        json={"sources": [{"document_id": foreign["id"], "matches": []}]},
        headers=room.master,
    )
    assert missing.status_code == 404
