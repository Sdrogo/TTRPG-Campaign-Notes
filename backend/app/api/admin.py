"""The Admin page's API (ticket 75 Decision 7): counts, growth, traffic,
server errors and background jobs, for the users listed in
`ADMIN_USER_IDS` only. Everyone else, signed in or not, gets 404, so the
route does not reveal that it exists."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.auth.dependencies import _bearer_scheme, authenticated_user
from app.config import settings
from app.db import admin_stats_repo
from app.db.session import SessionDep
from app.domain.admin_stats import (
    ErrorItem,
    GroupTraffic,
    HourTraffic,
    JobCounts,
    Overview,
    WeekCount,
    is_admin,
    summarize_traffic,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/admin", tags=["admin"])

TRAFFIC_DAYS = 7


async def require_admin(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    locale: LocaleDep,
) -> str:
    """The caller's id when they are an admin; 401 without a valid token,
    404 for anyone else. Ignores `X-View-As`: the page is about the app,
    not a Room."""
    caller = authenticated_user(credentials, locale)
    if not is_admin(caller.id, settings.admin_user_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return caller.id


class TrafficResponse(BaseModel):
    """Requests per route group and per hour over the last 7 days."""

    days: int
    groups: list[GroupTraffic]
    hours: list[HourTraffic]


class JobsResponse(BaseModel):
    """Room PDF exports and Document imports."""

    exports: JobCounts
    imports: JobCounts


class AdminStatsResponse(BaseModel):
    """Everything the Admin page shows, in one response."""

    generated_at: datetime
    overview: Overview
    growth: list[WeekCount]
    traffic: TrafficResponse
    errors: list[ErrorItem]
    jobs: JobsResponse


@router.get("/stats")
async def get_stats(
    _: Annotated[str, Depends(require_admin)], session: SessionDep
) -> AdminStatsResponse:
    """The Admin page's numbers. 404 unless the caller is listed in
    `ADMIN_USER_IDS`. Counts and timings only: no names, no emails, no
    content."""
    now = datetime.now(UTC)
    traffic = summarize_traffic(
        await admin_stats_repo.traffic_rows(session, now - timedelta(days=TRAFFIC_DAYS))
    )
    return AdminStatsResponse(
        generated_at=now,
        overview=await admin_stats_repo.overview(session, now),
        growth=await admin_stats_repo.growth(session, now),
        traffic=TrafficResponse(days=TRAFFIC_DAYS, groups=traffic.groups, hours=traffic.hours),
        errors=await admin_stats_repo.recent_errors(session),
        jobs=JobsResponse(
            exports=await admin_stats_repo.job_counts(session, "export_jobs", now),
            imports=await admin_stats_repo.job_counts(session, "import_jobs", now),
        ),
    )
