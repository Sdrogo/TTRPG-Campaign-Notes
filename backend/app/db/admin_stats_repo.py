"""The queries behind the Admin page (ticket 75 Decision 7). Every one
returns counts or timings, never content; none goes through the visibility
filter because none returns anything a filter could hide (Invariant 1)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ErrorEventRow, RequestStatsHourlyRow
from app.domain.admin_stats import ErrorItem, HourRow, JobCounts, Overview, WeekCount

# A user is "active" when one of their signed-in browsers refreshed its
# token (every few minutes of use, ticket 73 step 3) or signed in.
_OVERVIEW = text(
    """
    SELECT
      (SELECT count(DISTINCT user_id) FROM auth_identities) AS users,
      (SELECT count(*) FROM (
         SELECT user_id FROM auth_identities GROUP BY user_id
         HAVING min(created_at) >= :since_7d) AS n) AS new_users_7d,
      (SELECT count(*) FROM (
         SELECT user_id FROM auth_identities GROUP BY user_id
         HAVING min(created_at) >= :since_30d) AS n) AS new_users_30d,
      (SELECT count(DISTINCT user_id) FROM auth_sessions
         WHERE COALESCE(rotated_at, created_at) >= :since_7d) AS active_users_7d,
      (SELECT count(DISTINCT user_id) FROM auth_sessions
         WHERE COALESCE(rotated_at, created_at) >= :since_30d) AS active_users_30d,
      (SELECT count(*) FROM rooms) AS rooms,
      (SELECT count(*) FROM documents) AS documents,
      (SELECT count(*) FROM relationship_maps
         WHERE source_document_id IS NULL AND kind = 'free') AS maps,
      (SELECT count(*) FROM relationship_maps WHERE kind = 'geographic') AS geographic_maps,
      (SELECT count(*) FROM session_zero) AS session_zeros,
      (SELECT count(*) FROM room_clocks) AS clocks,
      (SELECT count(*) FROM document_files) AS files,
      (SELECT COALESCE(sum(size_bytes), 0) FROM document_files) AS files_bytes,
      (SELECT count(*) FROM document_images) AS images,
      pg_database_size(current_database()) AS database_bytes
    """
)

_PROVIDERS = text("SELECT provider, count(*) FROM auth_identities GROUP BY provider")

# Weeks start on Monday (date_trunc('week')), in UTC.
_GROWTH = text(
    """
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', CAST(:now AS timestamptz) AT TIME ZONE 'UTC')
          - (:weeks - 1) * interval '1 week',
        date_trunc('week', CAST(:now AS timestamptz) AT TIME ZONE 'UTC'),
        interval '1 week') AS week
    ),
    firsts AS (
      SELECT date_trunc('week', min(created_at) AT TIME ZONE 'UTC') AS week
      FROM auth_identities GROUP BY user_id
    ),
    rooms_by_week AS (
      SELECT date_trunc('week', created_at AT TIME ZONE 'UTC') AS week FROM rooms
    )
    SELECT weeks.week,
      (SELECT count(*) FROM firsts WHERE firsts.week = weeks.week) AS new_users,
      (SELECT count(*) FROM rooms_by_week WHERE rooms_by_week.week = weeks.week) AS new_rooms
    FROM weeks ORDER BY weeks.week
    """
)

_JOBS = """
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'running')) AS running,
      count(*) FILTER (WHERE status = 'done' AND finished_at >= :since) AS done,
      count(*) FILTER (WHERE status = 'failed' AND finished_at >= :since) AS failed
    FROM {table}
"""


async def overview(session: AsyncSession, now: datetime) -> Overview:
    """The totals, with "new" and "active" over the last 7 and 30 days."""
    row = (
        await session.execute(
            _OVERVIEW,
            {"since_7d": now - timedelta(days=7), "since_30d": now - timedelta(days=30)},
        )
    ).one()
    providers = {
        str(provider): int(count) for provider, count in (await session.execute(_PROVIDERS)).all()
    }
    values = row._mapping
    return Overview(
        sign_ins_by_provider=providers,
        **{name: int(values[name]) for name in values.keys()},
    )


async def growth(session: AsyncSession, now: datetime, weeks: int = 26) -> list[WeekCount]:
    """New users (by their first sign-in) and new Rooms per week, oldest
    first, the current week included. Weeks are computed in UTC and come
    back as UTC times."""
    rows = await session.execute(_GROWTH, {"now": now, "weeks": weeks})
    return [
        WeekCount(week=week.replace(tzinfo=UTC), new_users=int(users), new_rooms=int(rooms))
        for week, users, rooms in rows.all()
    ]


async def traffic_rows(session: AsyncSession, since: datetime) -> list[HourRow]:
    """The stored hourly rows since a moment, oldest first."""
    rows = await session.scalars(
        select(RequestStatsHourlyRow)
        .where(RequestStatsHourlyRow.hour >= since)
        .order_by(RequestStatsHourlyRow.hour, RequestStatsHourlyRow.route_group)
    )
    return [
        HourRow(
            hour=row.hour,
            group=row.route_group,
            requests=row.requests,
            client_errors=row.client_errors,
            server_errors=row.server_errors,
            latency=list(row.latency),
        )
        for row in rows
    ]


async def recent_errors(session: AsyncSession, limit: int = 100) -> list[ErrorItem]:
    """The newest stored server errors."""
    rows = await session.scalars(
        select(ErrorEventRow)
        .order_by(ErrorEventRow.occurred_at.desc(), ErrorEventRow.id.desc())
        .limit(limit)
    )
    return [
        ErrorItem(
            occurred_at=row.occurred_at,
            method=row.method,
            route=row.route,
            status=row.status,
            exc_type=row.exc_type,
            request_id=row.request_id,
        )
        for row in rows
    ]


async def job_counts(session: AsyncSession, table: str, now: datetime) -> JobCounts:
    """Running, done and failed jobs of `export_jobs` or `import_jobs`."""
    if table not in ("export_jobs", "import_jobs"):
        raise ValueError(table)
    row = (
        await session.execute(text(_JOBS.format(table=table)), {"since": now - timedelta(days=7)})
    ).one()
    return JobCounts(running=int(row.running), done_7d=int(row.done), failed_7d=int(row.failed))
