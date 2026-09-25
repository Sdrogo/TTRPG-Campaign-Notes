"""The signed-in user's own profile (FR-A2): name, pronouns, description and
avatar. Every route acts on the caller only - there is no user id in the
path, so nobody can edit someone else's profile."""

import logging
import uuid
from dataclasses import replace

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import translated_error
from app.api.image_uploads import fetch_url, normalize, read_upload, upload_object
from app.api.profiles import ProfileFields, profile_fields, sign_avatars
from app.auth.dependencies import CurrentUser, CurrentUserDep
from app.db import storage_cleanup, users_repo
from app.db.session import SessionDep
from app.domain.images import AVATAR_DIMENSION, NormalizedImage
from app.domain.models import UserProfile
from app.domain.profiles import (
    ProfileChanges,
    ProfileFieldTooLongError,
    google_avatar_source,
    plan_avatar_path,
    plan_google_prefill,
    plan_profile_update,
)
from app.i18n.dependencies import LocaleDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["account"])


class AccountResponse(ProfileFields):
    """The caller's own profile, in the same shape every other response uses
    for a user (`ProfileFields`), plus their id."""

    user_id: uuid.UUID


class UpdateProfileRequest(BaseModel):
    """Omitted fields are left alone; `null` or a blank string clears one."""

    display_name: str | None = None
    pronouns: str | None = None
    bio: str | None = None


class AvatarFromUrlRequest(BaseModel):
    """An avatar to import from a URL instead of uploading a file."""

    url: HttpUrl


async def _response(profile: UserProfile) -> AccountResponse:
    """Serializes the profile with its avatar signed for this response."""
    fields = profile_fields(profile, await sign_avatars([profile]))
    return AccountResponse(user_id=profile.user_id, **fields.model_dump())


async def _load_for_update(session: AsyncSession, current_user: CurrentUser) -> UserProfile:
    """Makes sure the user's mirror row exists (they may never have created
    or joined a Room) and locks it for the rest of the request."""
    user_id = uuid.UUID(current_user.id)
    await users_repo.upsert_user(session, user_id, current_user.email)
    return await users_repo.get_profile(session, user_id, for_update=True)


async def _replace_avatar(
    session: AsyncSession, profile: UserProfile, new_path: str | None
) -> UserProfile:
    """Points the profile at `new_path` (None removes the avatar) and settles
    Storage in the same transaction: the new object is confirmed, the old one
    scheduled for removal after commit (app/db/storage_cleanup.py)."""
    updated = replace(profile, avatar_path=new_path)
    await users_repo.save_profile(session, updated)
    if new_path is not None:
        await storage_cleanup.confirm_upload(session, new_path)
    if profile.avatar_path is not None:
        await storage_cleanup.schedule_removal(session, [profile.avatar_path])
    return updated


async def _normalize_avatar(data: bytes, locale: str) -> NormalizedImage:
    """The shared image pipeline with the avatar settings: a square crop at
    `AVATAR_DIMENSION`."""
    return await normalize(data, locale, max_dimension=AVATAR_DIMENSION, square=True)


async def _upload_avatar(user_id: uuid.UUID, normalized: NormalizedImage, locale: str) -> str:
    """Uploads an avatar and returns its path. The caller must reference it
    in the same transaction (see `_replace_avatar`)."""
    path = plan_avatar_path(user_id)
    await upload_object(path, normalized, locale)
    return path


async def _store_avatar(
    session: AsyncSession, current_user: CurrentUser, data: bytes, locale: str
) -> UserProfile:
    # Validated before locking the row, so a bad file doesn't hold the lock.
    """Validates, uploads and swaps in a new avatar from raw bytes, shared by
    the upload and import-from-URL routes."""
    normalized = await _normalize_avatar(data, locale)
    profile = await _load_for_update(session, current_user)
    path = await _upload_avatar(profile.user_id, normalized, locale)
    return await _replace_avatar(session, profile, path)


async def _prefill_from_google(
    session: AsyncSession, current_user: CurrentUser, locale: str
) -> UserProfile:
    """Copies the Google name and picture in as defaults, once per user,
    for whatever the user hasn't set. Best effort for the picture: if it
    can't be fetched or stored, the user just starts without an avatar."""
    profile = await _load_for_update(session, current_user)
    if profile.google_prefilled:
        return profile  # Another request got here first.

    updated = plan_google_prefill(profile, current_user.google_name)
    await users_repo.save_profile(session, updated)
    source = google_avatar_source(current_user.google_picture_url)
    if updated.avatar_path is None and source is not None:
        try:
            data = await fetch_url(source, locale)
            path = await _upload_avatar(
                profile.user_id, await _normalize_avatar(data, locale), locale
            )
        except HTTPException as exc:
            logger.warning("Could not import the Google picture: %s", exc.detail)
        else:
            updated = await _replace_avatar(session, updated, path)
    await users_repo.mark_prefilled(session, profile.user_id)
    return replace(updated, google_prefilled=True)


@router.get("")
async def get_account(
    current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> AccountResponse:
    """The caller's profile. The first call per user also copies in their
    Google name and picture as defaults (`_prefill_from_google`)."""
    user_id = uuid.UUID(current_user.id)
    profile = await users_repo.get_profile(session, user_id)
    if not profile.google_prefilled:
        profile = await _prefill_from_google(session, current_user, locale)
    if profile.email is None:
        # No mirror row yet (or no stored email): the token still knows it.
        profile = replace(profile, email=current_user.email)
    return await _response(profile)


@router.patch("")
async def update_account(
    body: UpdateProfileRequest, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> AccountResponse:
    """Updates only the fields sent; `null` or a blank string clears one. 422
    when a field is over its length limit."""
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
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    await users_repo.save_profile(session, updated)
    return await _response(updated)


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> AccountResponse:
    """Replaces the avatar with an uploaded image (cropped square, re-encoded
    as WebP)."""
    data = await read_upload(file)
    return await _response(await _store_avatar(session, current_user, data, locale))


@router.post("/avatar/from-url")
async def import_avatar(
    body: AvatarFromUrlRequest, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> AccountResponse:
    """Replaces the avatar with an image fetched from a URL."""
    data = await fetch_url(str(body.url), locale)
    return await _response(await _store_avatar(session, current_user, data, locale))


@router.delete("/avatar")
async def remove_avatar(current_user: CurrentUserDep, session: SessionDep) -> AccountResponse:
    """Clears the avatar, so the user is shown by their initials."""
    profile = await _load_for_update(session, current_user)
    return await _response(await _replace_avatar(session, profile, None))
