"""The FastAPI application: CORS, the routers, and the background Storage and Room PDF sweeps
that run for the app's lifetime."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.account import router as account_router
from app.api.account_data import router as account_data_router
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.characters import router as characters_router
from app.api.clock_groups import router as clock_groups_router
from app.api.clocks import router as clocks_router
from app.api.comments import router as comments_router
from app.api.document_files import router as document_files_router
from app.api.documents import router as documents_router
from app.api.events import router as events_router
from app.api.export import router as export_router
from app.api.export_pdf import router as export_pdf_router
from app.api.friends import router as friends_router
from app.api.geographic_maps import router as geographic_maps_router
from app.api.history import router as history_router
from app.api.image_search import router as image_search_router
from app.api.import_job import resume_import_jobs
from app.api.imports import router as imports_router
from app.api.invitations import router as invitations_router
from app.api.main_items import router as main_items_router
from app.api.map_files import router as map_files_router
from app.api.map_legend_presets import router as map_legend_presets_router
from app.api.mention_maps import linked_router as linked_maps_router
from app.api.mention_maps import router as mention_maps_router
from app.api.mention_suggestions import router as mention_suggestions_router
from app.api.mentions import router as mentions_router
from app.api.notes import router as notes_router
from app.api.relationship_maps import router as relationship_maps_router
from app.api.request_metrics import RequestMetricsMiddleware
from app.api.reveals import router as reveals_router
from app.api.room_copy import router as room_copy_router
from app.api.room_image import router as room_image_router
from app.api.room_sections import router as room_sections_router
from app.api.rooms import router as rooms_router
from app.api.search import router as search_router
from app.api.session_zero import router as session_zero_router
from app.api.session_zero_ddi import router as session_zero_ddi_router
from app.api.session_zero_polls import router as session_zero_polls_router
from app.api.session_zero_questions import router as session_zero_questions_router
from app.api.tags import router as tags_router
from app.api.versions import router as versions_router
from app.auth.tokens import require_secret
from app.config import Settings, settings
from app.db import session as session_module
from app.db.export_jobs_repo import run_export_sweeper
from app.db.monitoring_repo import run_flusher
from app.db.storage_cleanup import run_sweeper
from app.logging_setup import configure_logging

configure_logging()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Starts the Storage cleanup sweep (app/db/storage_cleanup.py) and the
    Room PDF sweep (app/db/export_jobs_repo.py) with the app and cancels them
    on shutdown. First it resumes the imports a restart cut off in their
    image phase (spec 59), so the startup sweep doesn't fail them. Refuses
    to start without a sign-in secret (ticket 73 step 3). Also runs the
    request statistics flush (ticket 75)."""
    require_secret()
    await resume_import_jobs()
    sweepers = [
        asyncio.create_task(run_sweeper()),
        asyncio.create_task(run_export_sweeper()),
        asyncio.create_task(run_flusher()),
    ]
    yield
    for sweeper in sweepers:
        sweeper.cancel()
    for sweeper in sweepers:
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper


def add_cors(target: FastAPI, config: Settings) -> None:
    """Allows the frontend's origins: the exact `cors_origins`, plus any
    origin matching `cors_origin_regex` (Vercel preview deploys). A function
    rather than inline so tests can check a preflight against a throwaway
    app wired exactly like this one."""
    target.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_origin_regex=config.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def docs_urls(config: Settings) -> dict[str, str | None]:
    """FastAPI's API docs paths, or `None` for each when `api_docs_enabled` is
    off (spec 72 Decision 8), which makes them 404."""
    if config.api_docs_enabled:
        return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


_docs = docs_urls(settings)
app = FastAPI(
    title="Ex Libris API",
    lifespan=lifespan,
    docs_url=_docs["docs_url"],
    redoc_url=_docs["redoc_url"],
    openapi_url=_docs["openapi_url"],
)
add_cors(app, settings)
# Added after CORS, so it is the outer one and also times and counts the
# preflights and the responses CORS refuses (ticket 75).
app.add_middleware(RequestMetricsMiddleware)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(account_router)
app.include_router(account_data_router)
app.include_router(rooms_router)
app.include_router(room_image_router)
app.include_router(room_sections_router)
app.include_router(room_copy_router)
app.include_router(invitations_router)
app.include_router(tags_router)
app.include_router(main_items_router)
app.include_router(documents_router)
app.include_router(comments_router)
app.include_router(notes_router)
app.include_router(reveals_router)
app.include_router(history_router)
app.include_router(document_files_router)
app.include_router(characters_router)
app.include_router(clocks_router)
app.include_router(clock_groups_router)
app.include_router(mentions_router)
app.include_router(mention_suggestions_router)
app.include_router(friends_router)
app.include_router(search_router)
app.include_router(image_search_router)
app.include_router(export_router)
app.include_router(export_pdf_router)
app.include_router(imports_router)
app.include_router(versions_router)
app.include_router(map_legend_presets_router)
app.include_router(relationship_maps_router)
app.include_router(geographic_maps_router)
app.include_router(map_files_router)
app.include_router(mention_maps_router)
app.include_router(linked_maps_router)
app.include_router(session_zero_router)
app.include_router(session_zero_questions_router)
app.include_router(session_zero_ddi_router)
app.include_router(session_zero_polls_router)
app.include_router(events_router)


@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict[str, str]:
    """Liveness check for the hosting platform and uptime monitors. Needs no
    auth and touches no dependency. Also answers HEAD, which many monitors
    send by default (a GET-only route would answer 405)."""
    return {"status": "ok"}


READY_TIMEOUT_SECONDS = 2.0


@app.api_route("/health/ready", methods=["GET", "HEAD"])
async def ready(response: Response) -> dict[str, str]:
    """Readiness for the uptime monitor (ticket 75 Decision 6): 200 when the
    database answers `SELECT 1` within 2 seconds, 503 otherwise, so a
    database outage alerts too. `/health` stays dependency-free for the
    container's healthcheck, which must not restart the backend because the
    database is down."""
    try:
        async with asyncio.timeout(READY_TIMEOUT_SECONDS):
            async with session_module.async_session_factory() as session:
                await session.execute(text("SELECT 1"))
    except Exception:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable"}
    return {"status": "ok"}


@app.api_route("/health/backup", methods=["GET", "HEAD"])
def backup_health(response: Response) -> dict[str, str]:
    """The nightly backup's age, for the uptime monitor (ticket 75 Decision
    6): 200 when the last good run (written by deploy/backup.sh) is newer
    than `BACKUP_MAX_AGE_HOURS`, 503 when it is older, missing or
    unreadable. 404 on a server without a backup (`BACKUP_STATUS_FILE`
    unset). Says nothing but the time of that run."""
    if not settings.backup_status_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    try:
        raw = Path(settings.backup_status_file).read_text(encoding="utf-8").strip()
        last_ok = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (OSError, ValueError):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "missing"}
    if last_ok.tzinfo is None:
        last_ok = last_ok.replace(tzinfo=UTC)
    if datetime.now(UTC) - last_ok > timedelta(hours=settings.backup_max_age_hours):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "stale", "last_ok": last_ok.isoformat()}
    return {"status": "ok", "last_ok": last_ok.isoformat()}
