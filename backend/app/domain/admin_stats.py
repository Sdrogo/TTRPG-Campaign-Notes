"""What the Admin page shows (ticket 75 Decision 7), as plain data, and who
may see it.

Counts and timings only: no Room or Document name, no email, no per-user
row. The numbers come from app/db/admin_stats_repo.py; the traffic summary
is computed here from the hourly rows."""

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime

from app.domain.request_stats import add_histograms, percentile_ms


def is_admin(user_id: str, admin_user_ids: Collection[str]) -> bool:
    """Whether the caller is listed in `ADMIN_USER_IDS`. Compared
    case-insensitively, since a UUID pasted by hand may be upper case; an
    empty list means nobody."""
    wanted = user_id.strip().lower()
    return any(wanted == listed.strip().lower() for listed in admin_user_ids if listed.strip())


@dataclass(frozen=True)
class Overview:
    """The totals at the top of the page."""

    users: int
    new_users_7d: int
    new_users_30d: int
    active_users_7d: int
    active_users_30d: int
    sign_ins_by_provider: dict[str, int]
    rooms: int
    documents: int
    maps: int
    geographic_maps: int
    session_zeros: int
    clocks: int
    files: int
    files_bytes: int
    images: int
    database_bytes: int


@dataclass(frozen=True)
class WeekCount:
    """New users and new Rooms in the week starting on `week` (Monday)."""

    week: datetime
    new_users: int
    new_rooms: int


@dataclass(frozen=True)
class HourRow:
    """One stored hour of one route group (`request_stats_hourly`)."""

    hour: datetime
    group: str
    requests: int
    client_errors: int
    server_errors: int
    latency: Sequence[int]


@dataclass(frozen=True)
class GroupTraffic:
    """A route group over the whole period: requests, 4xx, 5xx, and the
    median and 95th percentile in milliseconds (`None` without timed
    requests, e.g. the live streams)."""

    group: str
    requests: int
    client_errors: int
    server_errors: int
    p50_ms: int | None
    p95_ms: int | None


@dataclass(frozen=True)
class HourTraffic:
    """All groups in one hour, for the chart."""

    hour: datetime
    requests: int
    server_errors: int


@dataclass(frozen=True)
class Traffic:
    """The traffic section: totals per group, busiest first, and per hour."""

    groups: list[GroupTraffic]
    hours: list[HourTraffic]


def summarize_traffic(rows: Sequence[HourRow]) -> Traffic:
    """Adds up the hourly rows per group and per hour."""
    by_group: dict[str, list[int]] = {}
    histograms: dict[str, list[int]] = {}
    by_hour: dict[datetime, list[int]] = {}
    for row in rows:
        totals = by_group.setdefault(row.group, [0, 0, 0])
        totals[0] += row.requests
        totals[1] += row.client_errors
        totals[2] += row.server_errors
        histograms[row.group] = add_histograms(histograms.get(row.group, []), row.latency)
        hour = by_hour.setdefault(row.hour, [0, 0])
        hour[0] += row.requests
        hour[1] += row.server_errors
    groups = [
        GroupTraffic(
            group=group,
            requests=totals[0],
            client_errors=totals[1],
            server_errors=totals[2],
            p50_ms=percentile_ms(histograms[group], 0.5),
            p95_ms=percentile_ms(histograms[group], 0.95),
        )
        for group, totals in by_group.items()
    ]
    groups.sort(key=lambda item: (-item.requests, item.group))
    hours = [
        HourTraffic(hour=hour, requests=values[0], server_errors=values[1])
        for hour, values in sorted(by_hour.items())
    ]
    return Traffic(groups=groups, hours=hours)


@dataclass(frozen=True)
class ErrorItem:
    """One stored server error."""

    occurred_at: datetime
    method: str
    route: str
    status: int
    exc_type: str | None
    request_id: str


@dataclass(frozen=True)
class JobCounts:
    """Room PDF exports or Document imports: running now, and finished or
    failed in the last 7 days."""

    running: int
    done_7d: int
    failed_7d: int
