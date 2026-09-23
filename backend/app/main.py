"""The FastAPI application: CORS, the routers, and the background Storage sweep
that runs for the app's lifetime."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.account import router as account_router
from app.api.auth import router as auth_router
from app.api.comments import router as comments_router
from app.api.documents import router as documents_router
from app.api.invitations import router as invitations_router
from app.api.rooms import router as rooms_router
from app.api.tags import router as tags_router
from app.config import settings
from app.db.storage_cleanup import run_sweeper


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Starts the Storage cleanup sweep (app/db/storage_cleanup.py) with the
    app and cancels it on shutdown."""
    sweeper = asyncio.create_task(run_sweeper())
    yield
    sweeper.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await sweeper


app = FastAPI(title="TTRPG Campaign Notes API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(account_router)
app.include_router(rooms_router)
app.include_router(invitations_router)
app.include_router(tags_router)
app.include_router(documents_router)
app.include_router(comments_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check for the hosting platform. Needs no auth and touches no
    dependency."""
    return {"status": "ok"}
