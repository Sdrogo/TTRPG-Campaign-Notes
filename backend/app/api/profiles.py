"""How a user is shown to others, shared by every response that names a user
(the members list, the user's own Account page), so they all serialize the
same fields the same way."""

from pydantic import BaseModel

from app.db import storage
from app.domain.models import UserProfile


class ProfileFields(BaseModel):
    email: str | None
    display_name: str | None
    pronouns: str | None
    bio: str | None
    avatar_url: str | None


def profile_fields(profile: UserProfile) -> ProfileFields:
    return ProfileFields(
        email=profile.email,
        display_name=profile.display_name,
        pronouns=profile.pronouns,
        bio=profile.bio,
        avatar_url=storage.public_url(profile.avatar_path) if profile.avatar_path else None,
    )
