import uuid
from collections.abc import AsyncIterator, Callable, Iterator

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import image_search
from app.config import settings
from app.db import openverse
from app.domain.image_search import ImageSearchError
from app.main import app

IMAGE_ID = "4bc43a04-ef46-4544-a0c1-63c63f56e276"
OPENVERSE_PAGE = {
    "result_count": 41,
    "page_count": 3,
    "page": 1,
    "results": [
        {
            "id": IMAGE_ID,
            "title": "Castle",
            "url": "https://live.staticflickr.com/1/castle.jpg",
            "width": 800,
            "height": 600,
            "creator": "Ada",
            "license": "by",
            "license_version": "2.0",
            "license_url": "https://creativecommons.org/licenses/by/2.0/",
            "foreign_landing_url": "https://www.flickr.com/photos/ada/1",
            "mature": False,
        }
    ],
}


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def _fresh_state() -> Iterator[None]:
    image_search.throttle.reset()
    openverse.reset_token()
    yield
    image_search.throttle.reset()
    openverse.reset_token()


Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def openverse_calls(monkeypatch: pytest.MonkeyPatch) -> Callable[[Handler], list[httpx.Request]]:
    """Points the Openverse client at `handler` and returns the requests it got."""

    def install(handler: Handler) -> list[httpx.Request]:
        calls: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return handler(request)

        monkeypatch.setattr(openverse, "transport", httpx.MockTransport(record))
        return calls

    return install


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> tuple[str, str, str, str]:
    """Returns (room_id, document_id, master_token, player_token)."""
    master = make_token(str(uuid.uuid4()))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=_auth(master))).json()
    document = (
        await client.post(
            f"/rooms/{room['id']}/documents", json={"name": "Strahd"}, headers=_auth(master)
        )
    ).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=_auth(master)
        )
    ).json()
    player = make_token(str(uuid.uuid4()))
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth(player))
    return room["id"], document["id"], master, player


def _path(room_id: str, document_id: str) -> str:
    return f"/rooms/{room_id}/documents/{document_id}/image-search"


async def test_master_searches_and_gets_mapped_results(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    calls = openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, document_id, master, _ = await _room(client, make_token)

    response = await client.get(
        _path(room_id, document_id), params={"q": "  old   castle "}, headers=_auth(master)
    )

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "id": IMAGE_ID,
                "thumbnail_url": f"https://api.openverse.org/v1/images/{IMAGE_ID}/thumb/",
                "url": "https://live.staticflickr.com/1/castle.jpg",
                "width": 800,
                "height": 600,
                "title": "Castle",
                "creator": "Ada",
                "license": "CC BY 2.0",
                "license_url": "https://creativecommons.org/licenses/by/2.0/",
                "source_url": "https://www.flickr.com/photos/ada/1",
            }
        ],
        "page": 1,
        "has_more": True,
    }
    [request] = calls
    assert request.url.host == "api.openverse.org"
    assert request.url.path == "/v1/images/"
    assert request.url.params["q"] == "old castle"
    assert request.url.params["page"] == "1"
    assert request.url.params["page_size"] == "20"
    assert request.url.params["mature"] == "false"
    # Anonymous by default, and never with the user's identity (Decision 6).
    assert "authorization" not in request.headers
    assert "ExLibris" in request.headers["user-agent"]


async def test_asks_for_the_requested_page(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    calls = openverse_calls(lambda _: httpx.Response(200, json={**OPENVERSE_PAGE, "page": 3}))
    room_id, document_id, master, _ = await _room(client, make_token)

    response = await client.get(
        _path(room_id, document_id), params={"q": "castle", "page": 3}, headers=_auth(master)
    )

    assert response.json()["page"] == 3
    assert response.json()["has_more"] is False
    assert calls[0].url.params["page"] == "3"


async def test_owner_who_is_a_player_may_search(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, _, _, player = await _room(client, make_token)
    own = (
        await client.post(
            f"/rooms/{room_id}/documents", json={"name": "Ireena"}, headers=_auth(player)
        )
    ).json()

    response = await client.get(_path(room_id, own["id"]), params={"q": "x"}, headers=_auth(player))

    assert response.status_code == 200


async def test_player_who_is_not_an_owner_is_refused(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    calls = openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, document_id, master, player = await _room(client, make_token)
    await client.patch(
        f"/rooms/{room_id}/documents/{document_id}",
        json={"visibility": "room"},
        headers=_auth(master),
    )

    response = await client.get(
        _path(room_id, document_id), params={"q": "castle"}, headers=_auth(player)
    )

    assert response.status_code == 403
    assert calls == []


async def test_a_document_hidden_from_the_requester_is_404(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    calls = openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, _, master, player = await _room(client, make_token)
    secret = (
        await client.post(
            f"/rooms/{room_id}/documents",
            json={"name": "Secret Plot", "visibility": "master"},
            headers=_auth(master),
        )
    ).json()

    response = await client.get(
        _path(room_id, secret["id"]), params={"q": "castle"}, headers=_auth(player)
    )

    assert response.status_code == 404
    assert calls == []


async def test_stranger_is_refused(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    calls = openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, document_id, _, _ = await _room(client, make_token)
    stranger = make_token(str(uuid.uuid4()))

    response = await client.get(
        _path(room_id, document_id), params={"q": "castle"}, headers=_auth(stranger)
    )

    assert response.status_code == 403
    assert calls == []


async def test_empty_query_is_422(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    calls = openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, document_id, master, _ = await _room(client, make_token)

    response = await client.get(
        _path(room_id, document_id),
        params={"q": "   "},
        headers={**_auth(master), "Accept-Language": "it"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Scrivi qualcosa da cercare"
    assert calls == []


@pytest.mark.parametrize(
    "params", [{"q": "x" * 201}, {"q": "x", "page": 0}, {"q": "x", "page": 13}]
)
async def test_out_of_range_parameters_are_422(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    params: dict[str, str | int],
) -> None:
    room_id, document_id, master, _ = await _room(client, make_token)

    response = await client.get(_path(room_id, document_id), params=params, headers=_auth(master))

    assert response.status_code == 422


async def test_too_many_searches_are_429(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def full(_: uuid.UUID) -> None:
        raise ImageSearchError("errors.imageSearch.throttled")

    calls = openverse_calls(lambda _: httpx.Response(200, json=OPENVERSE_PAGE))
    room_id, document_id, master, _ = await _room(client, make_token)
    monkeypatch.setattr(image_search.throttle, "check", full)

    response = await client.get(
        _path(room_id, document_id), params={"q": "castle"}, headers=_auth(master)
    )

    assert response.status_code == 429
    assert response.json()["detail"] == "Too many searches: wait a minute and try again"
    assert calls == []


@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(429, json={"detail": "throttled"}),
        httpx.Response(500),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json=["not", "an", "object"]),
    ],
)
async def test_openverse_failure_is_502(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
    reply: httpx.Response,
) -> None:
    openverse_calls(lambda _: reply)
    room_id, document_id, master, _ = await _room(client, make_token)

    response = await client.get(
        _path(room_id, document_id), params={"q": "castle"}, headers=_auth(master)
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Image search is unavailable right now, try again later"


async def test_openverse_unreachable_is_502(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    openverse_calls(down)
    room_id, document_id, master, _ = await _room(client, make_token)

    response = await client.get(
        _path(room_id, document_id), params={"q": "castle"}, headers=_auth(master)
    )

    assert response.status_code == 502


# The token flow, against the Openverse client directly.


@pytest.fixture
def credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "openverse_client_id", "client")
    monkeypatch.setattr(settings, "openverse_client_secret", "secret")


def _token_then_search(token_body: object) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/auth_tokens/token/":
            return httpx.Response(200, json=token_body)
        return httpx.Response(200, json=OPENVERSE_PAGE)

    return handler


async def test_configured_credentials_get_a_token_once(
    credentials: None, openverse_calls: Callable[[Handler], list[httpx.Request]]
) -> None:
    calls = openverse_calls(_token_then_search({"access_token": "tok", "expires_in": 3600}))

    await openverse.search_images("castle", 1)
    await openverse.search_images("castle", 2)

    paths = [c.url.path for c in calls]
    assert paths == ["/v1/auth_tokens/token/", "/v1/images/", "/v1/images/"]
    assert b"grant_type=client_credentials" in calls[0].content
    assert b"client_id=client" in calls[0].content
    assert calls[1].headers["authorization"] == "Bearer tok"
    assert calls[2].headers["authorization"] == "Bearer tok"


async def test_an_expiring_token_is_renewed(
    credentials: None, openverse_calls: Callable[[Handler], list[httpx.Request]]
) -> None:
    # Shorter than the renewal margin: already due when it arrives.
    calls = openverse_calls(_token_then_search({"access_token": "tok", "expires_in": 30}))

    await openverse.search_images("castle", 1)
    await openverse.search_images("castle", 1)

    assert [c.url.path for c in calls].count("/v1/auth_tokens/token/") == 2


async def test_a_refused_token_is_forgotten(
    credentials: None, openverse_calls: Callable[[Handler], list[httpx.Request]]
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/auth_tokens/token/":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        return httpx.Response(401)

    calls = openverse_calls(handler)

    with pytest.raises(ImageSearchError):
        await openverse.search_images("castle", 1)
    with pytest.raises(ImageSearchError):
        await openverse.search_images("castle", 1)

    assert [c.url.path for c in calls].count("/v1/auth_tokens/token/") == 2


@pytest.mark.parametrize("token_body", [{"expires_in": 3600}, ["no"], {"access_token": "t"}])
async def test_a_bad_token_reply_is_unavailable(
    credentials: None,
    openverse_calls: Callable[[Handler], list[httpx.Request]],
    token_body: object,
) -> None:
    openverse_calls(_token_then_search(token_body))

    with pytest.raises(ImageSearchError, match="errors.imageSearch.unavailable"):
        await openverse.search_images("castle", 1)
