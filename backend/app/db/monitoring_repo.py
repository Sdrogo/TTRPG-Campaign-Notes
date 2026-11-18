"""Writes the request statistics and server errors of ticket 75 to the
database, and removes old ones: statistics after 90 days, errors after 30.

The middleware (app/api/request_metrics.py, with app/domain/request_stats.py)
counts in memory; `run_flusher` writes those counts every minute, adding to
the hour's row, so several
processes (a later ticket's several workers) can share one table without
shared counters."""

import asyncio
import logging
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session as session_module
from app.db.models import ErrorEventRow, RequestStatsHourlyRow
from app.domain import request_stats
from app.domain.request_stats import Bucket, BucketKey, ErrorEvent

logger = logging.getLogger(__name__)

FLUSH_INTERVAL_SECONDS = 60
STATS_KEPT = timedelta(days=90)
ERRORS_KEPT = timedelta(days=30)
# The cleanup runs on one flush in this many (about hourly).
_CLEANUP_EVERY = 60


async def save_buckets(session: AsyncSession, buckets: Mapping[BucketKey, Bucket]) -> None:
    """Adds the counts to each (hour, group) row, creating it if needed. The
    histograms are summed bucket by bucket in SQL."""
    if not buckets:
        return
    statement = insert(RequestStatsHourlyRow).values(
        [
            {
                "hour": hour,
                "route_group": group,
                "requests": bucket.requests,
                "client_errors": bucket.client_errors,
                "server_errors": bucket.server_errors,
                "latency": bucket.latency,
            }
            for (hour, group), bucket in buckets.items()
        ]
    )
    table = RequestStatsHourlyRow.__table__
    excluded = statement.excluded
    statement = statement.on_conflict_do_update(
        index_elements=["hour", "route_group"],
        set_={
            "requests": table.c.requests + excluded.requests,
            "client_errors": table.c.client_errors + excluded.client_errors,
            "server_errors": table.c.server_errors + excluded.server_errors,
            "latency": text(
                "ARRAY(SELECT COALESCE(a, 0) + COALESCE(b, 0) FROM unnest("
                "request_stats_hourly.latency, excluded.latency) WITH ORDINALITY AS u(a, b, n)"
                " ORDER BY n)"
            ),
        },
    )
    await session.execute(statement)


async def save_errors(session: AsyncSession, events: Iterable[ErrorEvent]) -> None:
    """Stores the server errors as they are."""
    rows = [
        {
            "occurred_at": event.occurred_at,
            "route": event.route[:300],
            "method": event.method[:10],
            "status": event.status,
            "exc_type": event.exc_type[:100] if event.exc_type else None,
            "request_id": event.request_id,
        }
        for event in events
    ]
    if rows:
        await session.execute(insert(ErrorEventRow).values(rows))


async def remove_old(session: AsyncSession, now: datetime) -> None:
    """Deletes statistics older than 90 days and errors older than 30."""
    await session.execute(
        delete(RequestStatsHourlyRow).where(RequestStatsHourlyRow.hour < now - STATS_KEPT)
    )
    await session.execute(
        delete(ErrorEventRow).where(ErrorEventRow.occurred_at < now - ERRORS_KEPT)
    )


async def flush(session: AsyncSession) -> None:
    """Writes what the middleware has counted since the last flush. Taken
    out of memory first, so a failed write drops a minute of counts rather
    than counting it twice."""
    buckets = request_stats.stats.take()
    errors = list(request_stats.pending_errors)
    request_stats.pending_errors.clear()
    await save_buckets(session, buckets)
    await save_errors(session, errors)


async def _flush_once(cleanup: bool) -> None:  # pragma: no cover - wraps flush/remove_old
    try:
        async with session_module.async_session_factory() as session:
            await flush(session)
            if cleanup:
                await remove_old(session, datetime.now(UTC))
            await session.commit()
    except Exception:
        logger.exception("Request statistics flush failed")


async def run_flusher() -> None:  # pragma: no cover - the loop around flush/remove_old
    """Runs for the app's lifetime (started from app/main.py's lifespan).
    When the app stops (a deploy, a restart) it writes what it holds one
    last time, so no minute of counts is lost."""
    rounds = 0
    try:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
            await _flush_once(rounds % _CLEANUP_EVERY == 0)
            rounds += 1
    except asyncio.CancelledError:
        await _flush_once(False)
        raise
