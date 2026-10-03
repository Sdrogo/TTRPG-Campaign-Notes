"""How a user is shown to others, shared by every response that names a user
(the members list, the user's own Account page), so they all serialize the
same fields the same way."""

import uuid
from collections.abc import Iterable, Mapping

from pydantic import BaseModel

from app.db import storage
from app.domain.models import UserProfile


class ProfileFields(BaseModel):
    """The public face of a user: what they chose to show. `email` is set
    only on the viewer's own profile: it is never shown to other users
    (NFR-03). `avatar_url` is a short-lived signed link, not the Storage
    path."""

    email: str | None
    display_name: str | None
    pronouns: str | None
    bio: str | None
    avatar_url: str | None


async def sign_avatars(profiles: Iterable[UserProfile]) -> dict[str, str]:
    """Signed URLs for the avatars of `profiles`, in one Storage request.
    Pass the result to `profile_fields`."""
    return await storage.signed_urls(
        [profile.avatar_path for profile in profiles if profile.avatar_path]
    )


def profile_fields(
    profile: UserProfile, avatar_urls: Mapping[str, str], viewer_id: uuid.UUID
) -> ProfileFields:
    """`profile` as `viewer_id` sees it: the email only when it is their own.
    An avatar Storage couldn't sign shows as none (initials)."""
    return ProfileFields(
        email=profile.email if profile.user_id == viewer_id else None,
        display_name=profile.display_name,
        pronouns=profile.pronouns,
        bio=profile.bio,
        avatar_url=avatar_urls.get(profile.avatar_path) if profile.avatar_path else None,
    )
