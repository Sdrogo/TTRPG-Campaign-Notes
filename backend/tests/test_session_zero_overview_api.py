"""Session 0 at a glance for the landing page (spec 55 Decision 8): every
session newest first, the steps each member has reached, their published
post-its counted, and the polls as the Session 0 page shows them."""

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
    return {"Authorization": f"Bearer {make_token(str(uuid.uuid4()))}", "Accept-Language": "en"}


async def _post(client: AsyncClient, url: str, headers: dict[str, str], **body: Any) -> Any:
    response = await client.post(url, json=body, headers=headers)
    assert response.status_code in (200, 201), response.text
    return response.json()


def _card(board: Any, body: str) -> Any:
    columns = [c for m in board["modules"] for c in m["columns"]] + board["lines_veils"]
    return next(card for c in columns for card in c["cards"] if card["body"] == body)


async def test_the_overview_before_and_after_the_start(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    master, player, outsider = (_headers(make_token) for _ in range(3))
    room = await _post(client, "/rooms", master, name="Tokyo")
    url = f"/rooms/{room['id']}/session-zero"
    invite = await _post(client, f"/rooms/{room['id']}/invitations", master, role="player")
    await _post(client, f"/invitations/{invite['code']}/accept", player)

    assert (await client.get(f"{url}/overview", headers=outsider)).status_code == 403
    before = (await client.get(f"{url}/overview", headers=player)).json()
    assert before == {"started": False, "rounds": [], "lines_veils": {}}

    board = await _post(client, f"{url}/start", master, modules=["retro", "poll"])
    retro, poll = board["modules"]
    column = retro["columns"][0]["id"]
    published = _card(
        await _post(client, f"{url}/cards", player, column_id=column, body="Fun"), "Fun"
    )
    await _post(client, f"{url}/cards/{published['id']}/publish", player)
    await _post(client, f"{url}/cards", player, column_id=column, body="Draft")
    lines = board["lines_veils"][0]
    line = _card(
        await _post(client, f"{url}/cards", master, column_id=lines["id"], body="Spiders"),
        "Spiders",
    )
    if line["draft"]:
        await _post(client, f"{url}/cards/{line['id']}/publish", master)
    polls = await client.put(
        f"{url}/modules/{poll['id']}/polls",
        json={"polls": [{"body": "System?", "options": [{"body": "A"}, {"body": "B"}]}]},
        headers=master,
    )
    assert polls.status_code == 200, polls.text
    await _post(client, f"{url}/rounds", master, title="Second", modules=["questions"])

    master_view = (await client.get(f"{url}/overview", headers=master)).json()
    player_view = (await client.get(f"{url}/overview", headers=player)).json()

    assert master_view["started"] is True
    assert [r["number"] for r in master_view["rounds"]] == [2, 1]
    second, first = master_view["rounds"]
    assert (second["title"], [s["kind"] for s in second["steps"]]) == ("Second", ["questions"])
    assert second["steps"][0]["questions"] is not None
    retro_step, poll_step = first["steps"]
    assert (retro_step["kind"], retro_step["cards"]) == ("retro", 1)
    assert [p["body"] for p in poll_step["polls"]] == ["System?"]
    assert master_view["lines_veils"][lines["kind"]] == 1
    assert sum(master_view["lines_veils"].values()) == 1
    # A Player sees only the steps already reached (spec 47 Decision 5).
    assert [s["kind"] for s in player_view["rounds"][1]["steps"]] == ["retro"]
    assert player_view["rounds"][1]["steps"][0]["cards"] == 1
