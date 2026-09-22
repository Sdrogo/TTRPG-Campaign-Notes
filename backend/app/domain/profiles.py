"""Rules for a user's own profile (FR-A2: name, avatar; plus pronouns and a
short description). A profile only ever belongs to the user editing it, so
there is no role or visibility check here - just input normalization."""

import re
import uuid
from dataclasses import dataclass, replace

from app.domain.images import OUTPUT_EXTENSION
from app.domain.models import UserProfile

MAX_DISPLAY_NAME_LENGTH = 60
MAX_PRONOUNS_LENGTH = 40
MAX_BIO_LENGTH = 1000

# Avatars share the images bucket, under their own prefix so they can never
# collide with a Document image path ({room_id}/{document_id}/...).
AVATAR_PATH_PREFIX = "avatars"

_WHITESPACE_RUN = re.compile(r"\s+")


class ProfileFieldTooLongError(Exception):
    def __init__(self, field: str, max_length: int) -> None:
        super().__init__(f"{field} must be at most {max_length} characters")
        self.field = field


@dataclass(frozen=True)
class ProfileChanges:
    """Only the fields the user sent; `None` inside a sent field clears it."""

    fields: frozenset[str]
    display_name: str | None = None
    pronouns: str | None = None
    bio: str | None = None


def _single_line(value: str | None, field: str, max_length: int) -> str | None:
    """Trims and collapses whitespace (newlines included): a name shown
    inline next to a Comment must stay on one line. Blank means unset."""
    if value is None:
        return None
    clean = _WHITESPACE_RUN.sub(" ", value).strip()
    if len(clean) > max_length:
        raise ProfileFieldTooLongError(field, max_length)
    return clean or None


def _multi_line(value: str | None, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    clean = value.replace("\r\n", "\n").strip()
    if len(clean) > max_length:
        raise ProfileFieldTooLongError(field, max_length)
    return clean or None


def plan_profile_update(current: UserProfile, changes: ProfileChanges) -> UserProfile:
    updated = current
    if "display_name" in changes.fields:
        updated = replace(
            updated,
            display_name=_single_line(
                changes.display_name, "display_name", MAX_DISPLAY_NAME_LENGTH
            ),
        )
    if "pronouns" in changes.fields:
        updated = replace(
            updated, pronouns=_single_line(changes.pronouns, "pronouns", MAX_PRONOUNS_LENGTH)
        )
    if "bio" in changes.fields:
        updated = replace(updated, bio=_multi_line(changes.bio, "bio", MAX_BIO_LENGTH))
    return updated


def plan_avatar_path(user_id: uuid.UUID) -> str:
    """A fresh random name per upload, so a replaced avatar never serves a
    stale cached copy under the same URL."""
    return f"{AVATAR_PATH_PREFIX}/{user_id}/{uuid.uuid4()}{OUTPUT_EXTENSION}"
