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
from app.config import Settings, settings
from app.db.storage_cleanup import run_sweeper


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    sweeper = asyncio.create_task(run_sweeper())
    yield
    sweeper.cancel()
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


app = FastAPI(title="TTRPG Campaign Notes API", lifespan=lifespan)
add_cors(app, settings)

app.include_router(auth_router)
app.include_router(account_router)
app.include_router(rooms_router)
app.include_router(invitations_router)
app.include_router(tags_router)
app.include_router(documents_router)
app.include_router(comments_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
