"""Rules for a user's own profile (FR-A2: name, avatar; plus pronouns and a
short description). A profile only ever belongs to the user editing it, so
there is no role or visibility check here - just input normalization."""

import re
import uuid
from dataclasses import dataclass, replace
from urllib.parse import urlsplit

from app.domain.errors import DomainError
from app.domain.images import AVATAR_DIMENSION, OUTPUT_EXTENSION
from app.domain.models import UserProfile

MAX_DISPLAY_NAME_LENGTH = 60
MAX_PRONOUNS_LENGTH = 40
MAX_BIO_LENGTH = 1000

# Avatars share the images bucket, under their own prefix so they can never
# collide with a Document image path ({room_id}/{document_id}/...).
AVATAR_PATH_PREFIX = "avatars"

_WHITESPACE_RUN = re.compile(r"\s+")
# Google profile picture URLs end with a size option, 96px by default.
_GOOGLE_SIZE_OPTION = re.compile(r"=s\d+(-c)?$")


class ProfileFieldTooLongError(DomainError):
    """A profile field is over its length limit. `field` names it, so the API
    can report which one."""

    def __init__(self, field: str, max_length: int) -> None:
        # `field` is the internal snake_case name (`display_name`, ...);
        # `@errors.account.fields.<field>` is translated to a human label
        # before it's interpolated into `fieldTooLong` (see
        # `app/i18n/translator.py::translate`'s `@`-prefix convention).
        super().__init__(
            "errors.account.fieldTooLong", field=f"@errors.account.fields.{field}", max=max_length
        )
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
    """Trims the value and normalizes line endings, keeping the line breaks a
    description may use. Blank means unset."""
    if value is None:
        return None
    clean = value.replace("\r\n", "\n").strip()
    if len(clean) > max_length:
        raise ProfileFieldTooLongError(field, max_length)
    return clean or None


def plan_profile_update(current: UserProfile, changes: ProfileChanges) -> UserProfile:
    """Applies only the fields in `changes.fields`, each normalized and checked
    against its length limit."""
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


def plan_google_prefill(current: UserProfile, google_name: str | None) -> UserProfile:
    """Offers the Google name as the default display name, once: only fills
    a name the user hasn't set, cut to the limit rather than rejected (the
    user didn't type it). The picture is imported separately, since that
    needs I/O."""
    if current.display_name is not None or google_name is None:
        return current
    clean = _WHITESPACE_RUN.sub(" ", google_name).strip()[:MAX_DISPLAY_NAME_LENGTH].strip()
    return replace(current, display_name=clean or None)


def google_avatar_source(picture_url: str | None) -> str | None:
    """The URL to import a Google profile picture from, asking Google for
    the size we store instead of its 96px default. Other URLs are used as
    they are."""
    if not picture_url:
        return None
    host = urlsplit(picture_url).hostname or ""
    if host.endswith(".googleusercontent.com") and _GOOGLE_SIZE_OPTION.search(picture_url):
        return _GOOGLE_SIZE_OPTION.sub(f"=s{AVATAR_DIMENSION}-c", picture_url)
    return picture_url
