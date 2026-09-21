from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.invitations import router as invitations_router
from app.api.rooms import router as rooms_router
from app.config import settings

app = FastAPI(title="TTRPG Campaign Notes API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(rooms_router)
app.include_router(invitations_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
