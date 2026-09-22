"""The signed-in user's own profile (FR-A2): name, pronouns, description and
avatar. Every route acts on the caller only - there is no user id in the
path, so nobody can edit someone else's profile."""

import uuid
from dataclasses import replace

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.image_uploads import fetch_url, normalize, read_upload, upload_object
from app.api.profiles import ProfileFields, profile_fields
from app.auth.dependencies import CurrentUser, CurrentUserDep
from app.db import storage_cleanup, users_repo
from app.db.session import SessionDep
from app.domain.images import AVATAR_DIMENSION
from app.domain.models import UserProfile
from app.domain.profiles import (
    ProfileChanges,
    ProfileFieldTooLongError,
    plan_avatar_path,
    plan_profile_update,
)

router = APIRouter(prefix="/account", tags=["account"])


class AccountResponse(ProfileFields):
    user_id: uuid.UUID


class UpdateProfileRequest(BaseModel):
    """Omitted fields are left alone; `null` or a blank string clears one."""

    display_name: str | None = None
    pronouns: str | None = None
    bio: str | None = None


class AvatarFromUrlRequest(BaseModel):
    url: HttpUrl


def _response(profile: UserProfile) -> AccountResponse:
    return AccountResponse(user_id=profile.user_id, **profile_fields(profile).model_dump())


async def _load_for_update(session: AsyncSession, current_user: CurrentUser) -> UserProfile:
    """Makes sure the user's mirror row exists (they may never have created
    or joined a Room) and locks it for the rest of the request."""
    user_id = uuid.UUID(current_user.id)
    await users_repo.upsert_user(session, user_id, current_user.email)
    return await users_repo.get_profile(session, user_id, for_update=True)


async def _replace_avatar(
    session: AsyncSession, profile: UserProfile, new_path: str | None
) -> UserProfile:
    updated = replace(profile, avatar_path=new_path)
    await users_repo.save_profile(session, updated)
    if new_path is not None:
        await storage_cleanup.confirm_upload(session, new_path)
    if profile.avatar_path is not None:
        await storage_cleanup.schedule_removal(session, [profile.avatar_path])
    return updated


async def _store_avatar(
    session: AsyncSession, current_user: CurrentUser, data: bytes
) -> UserProfile:
    normalized = await normalize(data, max_dimension=AVATAR_DIMENSION, square=True)
    profile = await _load_for_update(session, current_user)
    path = plan_avatar_path(profile.user_id)
    await upload_object(path, normalized)
    return await _replace_avatar(session, profile, path)


@router.get("")
async def get_account(current_user: CurrentUserDep, session: SessionDep) -> AccountResponse:
    user_id = uuid.UUID(current_user.id)
    profile = await users_repo.get_profile(session, user_id)
    if profile.email is None:
        # No mirror row yet (or no stored email): the token still knows it.
        profile = replace(profile, email=current_user.email)
    return _response(profile)


@router.patch("")
async def update_account(
    body: UpdateProfileRequest, current_user: CurrentUserDep, session: SessionDep
) -> AccountResponse:
    changes = ProfileChanges(
        fields=frozenset(body.model_fields_set),
        display_name=body.display_name,
        pronouns=body.pronouns,
        bio=body.bio,
    )
    profile = await _load_for_update(session, current_user)
    try:
        updated = plan_profile_update(profile, changes)
    except ProfileFieldTooLongError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    await users_repo.save_profile(session, updated)
    return _response(updated)


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile, current_user: CurrentUserDep, session: SessionDep
) -> AccountResponse:
    data = await read_upload(file)
    return _response(await _store_avatar(session, current_user, data))


@router.post("/avatar/from-url")
async def import_avatar(
    body: AvatarFromUrlRequest, current_user: CurrentUserDep, session: SessionDep
) -> AccountResponse:
    data = await fetch_url(str(body.url))
    return _response(await _store_avatar(session, current_user, data))


@router.delete("/avatar")
async def remove_avatar(current_user: CurrentUserDep, session: SessionDep) -> AccountResponse:
    profile = await _load_for_update(session, current_user)
    return _response(await _replace_avatar(session, profile, None))
