from fastapi import APIRouter

from app.auth.dependencies import CurrentUser, CurrentUserDep

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def get_me(current_user: CurrentUserDep) -> CurrentUser:
    return current_user
