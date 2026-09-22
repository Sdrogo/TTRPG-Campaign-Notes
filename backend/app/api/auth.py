from fastapi import APIRouter
from pydantic import BaseModel

from app.auth.dependencies import CurrentUserDep

router = APIRouter(prefix="/auth", tags=["auth"])


class MeResponse(BaseModel):
    """Who the token belongs to. The user's profile lives at /account."""

    id: str
    email: str | None


@router.get("/me")
def get_me(current_user: CurrentUserDep) -> MeResponse:
    return MeResponse(id=current_user.id, email=current_user.email)
