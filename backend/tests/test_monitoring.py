"""Ticket 75: request statistics, JSON logs, the readiness check and the
Admin page's API."""

import asyncio
import json
import logging
import sys
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import request_metrics
from app.config import Settings, settings
from app.db import admin_stats_repo, monitoring_repo
from app.db import session as session_module
from app.db.models import ErrorEventRow, RequestStatsHourlyRow
from app.domain import request_stats
from app.domain.admin_stats import HourRow, is_admin, summarize_traffic
from app.domain.request_stats import (
    BUCKET_COUNT,
    LATENCY_BOUNDS_MS,
    Bucket,
    ErrorEvent,
    RequestStats,
    add_histograms,
    hour_of,
    latency_bucket,
    percentile_ms,
    route_group,
)
from app.logging_setup import JsonFormatter, configure_logging, request_id_var
from app.main import app

ADMIN_ID = str(uuid.uuid4())

# A route that fails, to see an unhandled exception go through the
# middleware. Mounted once, on the real app, outside every real prefix.
_boom_router = APIRouter()


class _BoomError(RuntimeError):
    pass


@_boom_router.get("/__test_boom/{item_id}")
async def _boom(item_id: str) -> None:
    raise _BoomError(f"secret value user@example.com {item_id}")


app.include_router(_boom_router)


@pytest.fixture(autouse=True)
def _fresh_stats() -> None:
    request_stats.stats.take()
    request_stats.pending_errors.clear()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _headers(make_token: Callable[..., str], user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


# --- domain: route groups, buckets, percentiles ---------------------------


@pytest.mark.parametrize(
    ("template", "group"),
    [
        (None, "unmatched"),
        ("/", "other"),
        ("/health", "health"),
        ("/auth/{provider}/callback", "auth"),
        ("/account/avatar", "account"),
        ("/friends", "account"),
        ("/rooms", "rooms"),
        ("/rooms/{room_id}", "rooms"),
        ("/rooms/{room_id}/members", "rooms"),
        ("/rooms/{room_id}/documents/{document_id}", "documents"),
        ("/rooms/{room_id}/maps/{map_id}", "maps"),
        ("/rooms/{room_id}/clock-rules", "clocks"),
        ("/rooms/{room_id}/session-zero/rounds", "session_zero"),
        ("/rooms/{room_id}/imports", "imports"),
        ("/rooms/{room_id}/exports/{job_id}", "exports"),
        ("/rooms/{room_id}/events", "live"),
        ("/rooms/{room_id}/session-zero/events", "live"),
        ("/admin/stats", "admin"),
        ("/something-new", "other"),
    ],
)
def test_route_group(template: str | None, group: str) -> None:
    assert route_group(template) == group


def test_latency_bucket_bounds() -> None:
    assert latency_bucket(0) == 0
    assert latency_bucket(25) == 0
    assert latency_bucket(25.1) == 1
    assert latency_bucket(10000) == len(LATENCY_BOUNDS_MS) - 1
    assert latency_bucket(10001) == len(LATENCY_BOUNDS_MS)


def test_hour_of_is_utc() -> None:
    from datetime import timezone

    rome = timezone(timedelta(hours=1))
    assert hour_of(datetime(2026, 11, 17, 10, 42, 7, tzinfo=rome)) == datetime(
        2026, 11, 17, 9, tzinfo=UTC
    )


def test_bucket_counts_errors_and_skips_live_latency() -> None:
    stats = RequestStats()
    moment = datetime(2026, 11, 17, 10, 5, tzinfo=UTC)
    stats.record(moment, "/rooms/{room_id}/documents", 200, 30)
    stats.record(moment, "/rooms/{room_id}/documents", 404, 30)
    stats.record(moment, "/rooms/{room_id}/documents", 503, 3000)
    stats.record(moment, "/rooms/{room_id}/events", 200, 900000)
    taken = stats.take()
    hour = datetime(2026, 11, 17, 10, tzinfo=UTC)
    documents = taken[(hour, "documents")]
    assert (documents.requests, documents.client_errors, documents.server_errors) == (3, 1, 1)
    assert sum(documents.latency) == 3
    live = taken[(hour, "live")]
    assert live.requests == 1
    assert sum(live.latency) == 0
    assert stats.take() == {}


def test_percentiles() -> None:
    assert percentile_ms([0] * BUCKET_COUNT, 0.5) is None
    histogram = [0] * BUCKET_COUNT
    histogram[1] = 90  # <= 50 ms
    histogram[5] = 10  # <= 1000 ms
    assert percentile_ms(histogram, 0.5) == 50
    assert percentile_ms(histogram, 0.95) == 1000
    slow = [0] * BUCKET_COUNT
    slow[-1] = 3
    assert percentile_ms(slow, 0.5) == LATENCY_BOUNDS_MS[-1]


def test_add_histograms_of_different_lengths() -> None:
    assert add_histograms([1, 2], [3, 4, 5]) == [4, 6, 5]
    assert add_histograms([], [1]) == [1]


def test_record_error_is_capped() -> None:
    event = ErrorEvent(
        occurred_at=datetime.now(UTC),
        route="/x",
        method="GET",
        status=500,
        exc_type=None,
        request_id="r",
    )
    for _ in range(request_stats.MAX_PENDING_ERRORS + 5):
        request_stats.record_error(event)
    assert len(request_stats.pending_errors) == request_stats.MAX_PENDING_ERRORS


def test_summarize_traffic() -> None:
    hour = datetime(2026, 11, 17, 10, tzinfo=UTC)
    later = hour + timedelta(hours=1)
    fast = [0] * BUCKET_COUNT
    fast[0] = 10
    rows = [
        HourRow(hour, "documents", 10, 1, 0, fast),
        HourRow(later, "documents", 10, 0, 2, fast),
        HourRow(hour, "auth", 30, 0, 0, fast[:5]),
        HourRow(hour, "live", 2, 0, 0, [0] * BUCKET_COUNT),
    ]
    traffic = summarize_traffic(rows)
    assert [group.group for group in traffic.groups] == ["auth", "documents", "live"]
    documents = traffic.groups[1]
    assert (documents.requests, documents.client_errors, documents.server_errors) == (20, 1, 2)
    assert documents.p50_ms == 25
    assert traffic.groups[2].p95_ms is None
    assert [(h.hour, h.requests, h.server_errors) for h in traffic.hours] == [
        (hour, 42, 0),
        (later, 10, 2),
    ]


def test_is_admin() -> None:
    upper = ADMIN_ID.upper()
    assert is_admin(ADMIN_ID, [f" {upper} "])
    assert not is_admin(ADMIN_ID, [])
    assert not is_admin(ADMIN_ID, ["", " "])
    assert not is_admin(ADMIN_ID, [ADMIN_ID[:-1] + "0" if ADMIN_ID[-1] != "0" else "1"])


def test_admin_user_ids_setting_parses_a_list() -> None:
    parsed = Settings(admin_user_ids=" a , ,b ")  # type: ignore[arg-type]
    assert parsed.admin_user_ids == ["a", "b"]
    assert Settings(admin_user_ids=["c"]).admin_user_ids == ["c"]


# --- JSON logs ------------------------------------------------------------


def _record(message: str, **extra: object) -> logging.LogRecord:
    record = logging.LogRecord("app.test", logging.INFO, __file__, 1, message, (), None)
    for name, value in extra.items():
        setattr(record, name, value)
    return record


def test_json_formatter_fields() -> None:
    token = request_id_var.set("abc123")
    try:
        line = JsonFormatter().format(_record("hello", route="/x", status=200, unknown="no"))
    finally:
        request_id_var.reset(token)
    entry = json.loads(line)
    assert entry["message"] == "hello"
    assert entry["level"] == "info"
    assert entry["logger"] == "app.test"
    assert entry["request_id"] == "abc123"
    assert entry["route"] == "/x"
    assert entry["status"] == 200
    assert "unknown" not in entry
    assert entry["time"].endswith("+00:00")


def test_json_formatter_exception() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        record = _record("failed")
        record.exc_info = sys.exc_info()
    entry = json.loads(JsonFormatter().format(record))
    assert entry["exc_type"] == "ValueError"
    assert "boom" in entry["traceback"]
    assert "request_id" not in entry


def test_configure_logging_rewires_uvicorn() -> None:
    root = logging.getLogger()
    saved = (root.handlers[:], root.level)
    try:
        configure_logging()
        assert isinstance(root.handlers[0].formatter, JsonFormatter)
        assert logging.getLogger("uvicorn.error").propagate
        assert logging.getLogger("uvicorn.access").disabled
    finally:
        root.handlers = saved[0]
        root.setLevel(saved[1])


# --- the middleware ---------------------------------------------------------


async def test_request_gets_an_id_and_is_counted(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert len(response.headers["x-request-id"]) == 16
    taken = request_stats.stats.take()
    assert [key[1] for key in taken] == ["health"]


async def test_unmatched_route_is_counted(client: AsyncClient) -> None:
    response = await client.get("/no/such/route")
    assert response.status_code == 404
    taken = request_stats.stats.take()
    (((_, group), bucket),) = taken.items()
    assert group == "unmatched"
    assert bucket.client_errors == 1


async def test_request_line_is_logged(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        await client.get("/no/such/route?token=secret", headers={"Authorization": "Bearer x"})
    (record,) = [r for r in caplog.records if r.name == "app.request"]
    line = JsonFormatter().format(record)
    assert "secret" not in line
    assert "Bearer" not in line
    entry = json.loads(line)
    assert entry["status"] == 404
    assert entry["group"] == "unmatched"


async def test_health_is_not_logged(client: AsyncClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        await client.get("/health")
    assert [r for r in caplog.records if r.name == "app.request"] == []


async def test_unhandled_error_is_recorded_without_its_message(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        response = await client.get("/__test_boom/42")
    assert response.status_code == 500
    (event,) = request_stats.pending_errors
    assert event.route == "/__test_boom/{item_id}"
    assert event.exc_type == "_BoomError"
    assert event.status == 500
    assert "example.com" not in repr(event)
    taken = request_stats.stats.take()
    assert sum(bucket.server_errors for bucket in taken.values()) == 1
    # The traceback, with the message, goes to the log only.
    assert any(r.exc_info for r in caplog.records if r.name == "app.request")


async def test_non_http_scopes_pass_through() -> None:
    seen: list[str] = []

    async def inner(scope: dict[str, object], receive: object, send: object) -> None:
        seen.append(str(scope["type"]))

    middleware = request_metrics.RequestMetricsMiddleware(inner)  # type: ignore[arg-type]
    await middleware({"type": "lifespan"}, None, None)  # type: ignore[arg-type]
    assert seen == ["lifespan"]
    assert request_stats.stats.take() == {}


async def test_a_request_abandoned_before_its_response_is_not_counted() -> None:
    async def inner(scope: dict[str, object], receive: object, send: object) -> None:
        raise asyncio.CancelledError

    middleware = request_metrics.RequestMetricsMiddleware(inner)  # type: ignore[arg-type]
    with pytest.raises(asyncio.CancelledError):
        await middleware({"type": "http", "method": "GET"}, None, None)  # type: ignore[arg-type]
    assert request_stats.stats.take() == {}
    assert request_stats.pending_errors == []


async def test_a_health_checks_503_is_counted_but_not_stored_as_an_error(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken() -> object:
        raise ConnectionError("no database")

    monkeypatch.setattr(session_module, "async_session_factory", broken)
    with caplog.at_level(logging.INFO, logger="app.request"):
        assert (await client.get("/health/ready")).status_code == 503
    assert request_stats.pending_errors == []
    taken = request_stats.stats.take()
    assert sum(bucket.server_errors for bucket in taken.values()) == 1
    assert [r.levelno for r in caplog.records if r.name == "app.request"] == [logging.ERROR]


async def test_an_error_after_the_response_started_is_raised() -> None:
    sent: list[dict[str, object]] = []

    async def inner(scope: object, receive: object, send: Callable[..., object]) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})  # type: ignore[misc]
        raise RuntimeError("mid-stream")

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    middleware = request_metrics.RequestMetricsMiddleware(inner)
    with pytest.raises(RuntimeError):
        await middleware({"type": "http", "method": "GET"}, None, send)  # type: ignore[arg-type]
    assert len(sent) == 1
    (event,) = request_stats.pending_errors
    assert event.exc_type == "RuntimeError"


# --- readiness ---------------------------------------------------------------


async def test_ready_when_the_database_answers(client: AsyncClient) -> None:
    response = await client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_not_ready_when_the_database_fails(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken() -> object:
        raise ConnectionError("no database")

    monkeypatch.setattr(session_module, "async_session_factory", broken)
    response = await client.get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


# --- storing ---------------------------------------------------------------


async def test_flush_adds_to_the_hours_row(db_session: AsyncSession) -> None:
    hour = datetime(2020, 1, 6, 10, tzinfo=UTC)
    first = Bucket(requests=2, client_errors=1, server_errors=0, latency=[1, 1] + [0] * 8)
    request_stats.stats.buckets[(hour, "documents")] = first
    request_stats.record_error(ErrorEvent(hour, "/rooms/{room_id}", "GET", 500, "KeyError", "abc"))
    await monitoring_repo.flush(db_session)
    second = Bucket(requests=3, client_errors=0, server_errors=1, latency=[0, 1] + [0] * 8)
    request_stats.stats.buckets[(hour, "documents")] = second
    await monitoring_repo.flush(db_session)
    await monitoring_repo.flush(db_session)  # nothing pending: no-op
    row = await db_session.scalar(
        select(RequestStatsHourlyRow).where(RequestStatsHourlyRow.hour == hour)
    )
    assert row is not None
    assert (row.requests, row.client_errors, row.server_errors) == (5, 1, 1)
    assert row.latency == [1, 2] + [0] * 8
    errors = (await db_session.scalars(select(ErrorEventRow))).all()
    assert [(e.route, e.exc_type, e.request_id) for e in errors] == [
        ("/rooms/{room_id}", "KeyError", "abc")
    ]


async def test_remove_old(db_session: AsyncSession) -> None:
    now = datetime(2026, 11, 17, tzinfo=UTC)
    await monitoring_repo.save_buckets(
        db_session,
        {
            (now - timedelta(days=91), "auth"): Bucket(requests=1),
            (now - timedelta(days=89), "auth"): Bucket(requests=1),
        },
    )
    await monitoring_repo.save_errors(
        db_session,
        [
            ErrorEvent(now - timedelta(days=31), "/a", "GET", 500, None, "old"),
            ErrorEvent(now - timedelta(days=29), "/a", "GET", 500, None, "new"),
        ],
    )
    await monitoring_repo.remove_old(db_session, now)
    hours = (await db_session.scalars(select(RequestStatsHourlyRow.hour))).all()
    assert hours == [now - timedelta(days=89)]
    ids = (await db_session.scalars(select(ErrorEventRow.request_id))).all()
    assert ids == ["new"]


async def test_job_counts_refuses_other_tables(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError):
        await admin_stats_repo.job_counts(db_session, "users", datetime.now(UTC))


# --- the Admin API -----------------------------------------------------------


async def test_admin_stats_is_hidden_from_non_admins(
    client: AsyncClient,
    db_session: AsyncSession,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "admin_user_ids", [ADMIN_ID])
    # Signed out or with a bad token: 404 too, like a route that doesn't exist.
    assert (await client.get("/admin/stats")).status_code == 404
    bad = {"Authorization": "Bearer not-a-token"}
    assert (await client.get("/admin/stats", headers=bad)).status_code == 404
    other = _headers(make_token, str(uuid.uuid4()))
    assert (await client.get("/admin/stats", headers=other)).status_code == 404
    monkeypatch.setattr(settings, "admin_user_ids", [])
    admin = _headers(make_token, ADMIN_ID)
    assert (await client.get("/admin/stats", headers=admin)).status_code == 404


async def _seed(session: AsyncSession, now: datetime) -> None:
    user_new, user_old = uuid.uuid4(), uuid.uuid4()
    identity = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO auth_identities"
            " (id, provider, provider_user_id, user_id, email, created_at)"
            " VALUES (:i1, 'google', :p1, :u1, 'new@example.com', :recent),"
            " (:i2, 'discord', :p2, :u2, 'old@example.com', :old),"
            " (:i3, 'github', :p3, :u2, NULL, :recent)"
        ),
        {
            "i1": identity,
            "i2": uuid.uuid4(),
            "i3": uuid.uuid4(),
            "p1": str(uuid.uuid4()),
            "p2": str(uuid.uuid4()),
            "p3": str(uuid.uuid4()),
            "u1": user_new,
            "u2": user_old,
            "recent": now - timedelta(days=2),
            "old": now - timedelta(days=100),
        },
    )
    await session.execute(
        text(
            "INSERT INTO auth_sessions"
            " (id, user_id, identity_id, token_hash, created_at, expires_at)"
            " VALUES (:id, :user, :identity, :hash, :at, :expires)"
        ),
        {
            "id": uuid.uuid4(),
            "user": user_new,
            "identity": identity,
            "hash": uuid.uuid4().hex,
            "at": now - timedelta(days=1),
            "expires": now + timedelta(days=30),
        },
    )
    await session.execute(
        text(
            "INSERT INTO rooms (id, name, status, created_by, created_at)"
            " VALUES (:id, 'R', 'active', :by, :at)"
        ),
        {"id": uuid.uuid4(), "by": user_new, "at": now - timedelta(days=1)},
    )
    histogram = [0] * BUCKET_COUNT
    histogram[2] = 4
    await monitoring_repo.save_buckets(
        session,
        {(hour_of(now - timedelta(hours=3)), "documents"): Bucket(4, 1, 1, histogram)},
    )
    await monitoring_repo.save_errors(
        session, [ErrorEvent(now - timedelta(hours=3), "/rooms/{room_id}", "GET", 500, "E", "rid")]
    )


async def test_admin_stats(
    client: AsyncClient,
    db_session: AsyncSession,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "admin_user_ids", [ADMIN_ID])
    before = await client.get("/admin/stats", headers=_headers(make_token, ADMIN_ID))
    assert before.status_code == 200
    baseline = before.json()["overview"]
    await _seed(db_session, datetime.now(UTC))

    response = await client.get("/admin/stats", headers=_headers(make_token, ADMIN_ID))
    assert response.status_code == 200
    body = response.json()
    overview = body["overview"]
    assert overview["users"] - baseline["users"] == 2
    assert overview["new_users_7d"] - baseline["new_users_7d"] == 1
    assert overview["active_users_7d"] - baseline["active_users_7d"] == 1
    assert overview["rooms"] - baseline["rooms"] == 1
    assert overview["database_bytes"] > 0
    assert overview["sign_ins_by_provider"]["github"] >= 1
    assert len(body["growth"]) == 26
    assert body["growth"][-1]["new_rooms"] >= 1
    assert body["growth"][-1]["week"].endswith("Z") or "+00:00" in body["growth"][-1]["week"]
    documents = next(g for g in body["traffic"]["groups"] if g["group"] == "documents")
    assert documents["requests"] >= 4
    assert documents["p50_ms"] == 100
    assert body["traffic"]["days"] == 7
    assert body["errors"][0]["request_id"] == "rid"
    assert set(body["jobs"]) == {"exports", "imports"}
    assert set(body["jobs"]["exports"]) == {"running", "done_7d", "failed_7d"}
    # Counts only: no email anywhere in the answer.
    assert "@example.com" not in response.text


async def test_account_says_whether_the_caller_is_admin(
    client: AsyncClient,
    db_session: AsyncSession,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "admin_user_ids", [ADMIN_ID])
    admin = await client.get("/account", headers=_headers(make_token, ADMIN_ID))
    assert admin.json()["app_admin"] is True
    other = await client.get("/account", headers=_headers(make_token, str(uuid.uuid4())))
    assert other.json()["app_admin"] is False


# --- backup age --------------------------------------------------------------


async def test_backup_health_is_404_without_a_status_file(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "backup_status_file", "")
    assert (await client.get("/health/backup")).status_code == 404


@pytest.mark.parametrize(
    ("content", "code", "state"),
    [
        (None, 503, "missing"),
        ("not a time", 503, "missing"),
        ("FRESH", 200, "ok"),
        ("FRESH_NAIVE", 200, "ok"),
        ("OLD", 503, "stale"),
    ],
)
async def test_backup_health(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    content: str | None,
    code: int,
    state: str,
) -> None:
    path = tmp_path / "backup-last-ok"
    now = datetime.now(UTC)
    values = {
        "FRESH": (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "FRESH_NAIVE": (now - timedelta(hours=2)).replace(tzinfo=None).isoformat(),
        "OLD": (now - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if content is not None:
        path.write_text(values.get(content, content) + "\n")
    monkeypatch.setattr(settings, "backup_status_file", str(path))
    response = await client.get("/health/backup")
    assert response.status_code == code
    assert response.json()["status"] == state
