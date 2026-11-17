"""Request statistics for the Admin page (ticket 75): which route group a
request belongs to, and hourly buckets of counts, error counts and a latency
histogram, kept in memory until the flush writes them to
`request_stats_hourly` (app/db/monitoring_repo.py).

Plain data only: the middleware (app/api/request_metrics.py) feeds it, so it
is tested without a server. Nothing here holds a user, an IP or a path with
ids in it, only the route group."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

# Upper bounds, in milliseconds, of the latency histogram's buckets; the last
# bucket takes everything slower. Stored as an array in that order, so the
# bounds may only ever be appended to, never changed.
LATENCY_BOUNDS_MS: tuple[int, ...] = (25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)
BUCKET_COUNT = len(LATENCY_BOUNDS_MS) + 1

# The groups, by the first segment after `/rooms/{room_id}/` (or the first
# segment for routes outside a Room). Anything else is "rooms" inside a Room
# and "other" outside; a request that matched no route is "unmatched".
_ROOM_GROUPS: dict[str, str] = {
    "documents": "documents",
    "maps": "maps",
    "map-legend-presets": "maps",
    "session-zero": "session_zero",
    "clocks": "clocks",
    "clocks-order": "clocks",
    "clock-groups": "clocks",
    "clock-groups-order": "clocks",
    "clock-rules": "clocks",
    "imports": "imports",
    "export": "exports",
    "exports": "exports",
}
_TOP_GROUPS: dict[str, str] = {
    "auth": "auth",
    "account": "account",
    "friends": "account",
    "invitations": "account",
    "reveals": "documents",
    "rooms": "rooms",
    "health": "health",
    "admin": "admin",
}
# Long-lived event streams (spec 46_2, spec 52): counted, but their duration
# is how long a page stayed open, not how fast the API answered.
LIVE_GROUP = "live"
UNMATCHED_GROUP = "unmatched"


def route_group(template: str | None) -> str:
    """The group of a route template such as `/rooms/{room_id}/documents/{id}`
    (not the raw path, so no ids). `None` (no route matched) is
    "unmatched"."""
    if template is None:
        return UNMATCHED_GROUP
    parts = [part for part in template.split("/") if part]
    if not parts:
        return "other"
    if parts[-1] == "events":
        return LIVE_GROUP
    if parts[0] == "rooms" and len(parts) >= 3:
        return _ROOM_GROUPS.get(parts[2], "rooms")
    return _TOP_GROUPS.get(parts[0], "other")


def latency_bucket(duration_ms: float) -> int:
    """The index of the histogram bucket a duration falls in."""
    for index, bound in enumerate(LATENCY_BOUNDS_MS):
        if duration_ms <= bound:
            return index
    return len(LATENCY_BOUNDS_MS)


def hour_of(moment: datetime) -> datetime:
    """The start of the UTC hour a moment falls in: the bucket's key."""
    return moment.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


@dataclass
class Bucket:
    """One hour of one route group: requests, how many answered 4xx and
    5xx, and the latency histogram (`LATENCY_BOUNDS_MS`)."""

    requests: int = 0
    client_errors: int = 0
    server_errors: int = 0
    latency: list[int] = field(default_factory=lambda: [0] * BUCKET_COUNT)

    def add(self, status: int, duration_ms: float | None) -> None:
        """Counts one request. `duration_ms` is `None` for a live stream,
        which stays out of the histogram."""
        self.requests += 1
        if 400 <= status < 500:
            self.client_errors += 1
        elif status >= 500:
            self.server_errors += 1
        if duration_ms is not None:
            self.latency[latency_bucket(duration_ms)] += 1


BucketKey = tuple[datetime, str]


@dataclass
class RequestStats:
    """The buckets not yet written, keyed by (hour, group). One per process;
    `take` hands them to the flush and starts empty again, so a failed write
    loses at most one minute of counts and never counts twice."""

    buckets: dict[BucketKey, Bucket] = field(default_factory=dict)

    def record(
        self, moment: datetime, template: str | None, status: int, duration_ms: float
    ) -> None:
        """Counts one finished request."""
        group = route_group(template)
        bucket = self.buckets.setdefault((hour_of(moment), group), Bucket())
        bucket.add(status, None if group == LIVE_GROUP else duration_ms)

    def take(self) -> dict[BucketKey, Bucket]:
        """Everything counted since the last call, emptied."""
        taken, self.buckets = self.buckets, {}
        return taken


@dataclass(frozen=True)
class ErrorEvent:
    """A server error as the Admin page lists it (ticket 75 Decision 7): no
    exception message, no user, no path with ids, only what is safe to keep
    for 30 days."""

    occurred_at: datetime
    route: str
    method: str
    status: int
    exc_type: str | None
    request_id: str


# The process's statistics and the errors waiting for the flush
# (app/db/monitoring_repo.py). One uvicorn process per server (spec 72), so
# plain module state is exact.
stats = RequestStats()
pending_errors: list[ErrorEvent] = []
# Bounds the errors kept between flushes if the database is down and every
# request fails: the newest are dropped, the log still has them.
MAX_PENDING_ERRORS = 1000


def record_error(event: ErrorEvent) -> None:
    """Keeps a server error for the next flush, up to `MAX_PENDING_ERRORS`."""
    if len(pending_errors) < MAX_PENDING_ERRORS:
        pending_errors.append(event)


def percentile_ms(histogram: Sequence[int], fraction: float) -> int | None:
    """The upper bound of the bucket holding the given fraction of requests
    (0.5 for the median, 0.95 for p95): an estimate no finer than the
    buckets, which is what a dashboard needs. `None` with no requests; the
    last bucket has no bound, so it reports the largest one."""
    total = sum(histogram)
    if total == 0:
        return None
    wanted = fraction * total
    running = 0
    for index, count in enumerate(histogram):
        running += count
        if running >= wanted:
            return LATENCY_BOUNDS_MS[min(index, len(LATENCY_BOUNDS_MS) - 1)]
    return LATENCY_BOUNDS_MS[-1]  # pragma: no cover - the loop always reaches `wanted`


def add_histograms(left: Sequence[int], right: Sequence[int]) -> list[int]:
    """Two histograms summed bucket by bucket (rows written before a bound
    was appended are shorter)."""
    size = max(len(left), len(right))
    return [
        (left[i] if i < len(left) else 0) + (right[i] if i < len(right) else 0) for i in range(size)
    ]
