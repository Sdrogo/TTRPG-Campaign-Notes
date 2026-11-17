"""Rules of the backend's own sign-in (ticket 73 step 3) that need no
database or network: where a sign-in may send the user back to, and what a
refresh token presented to `/auth/refresh` is worth."""

import re
from datetime import datetime, timedelta
from enum import StrEnum
from urllib.parse import urlsplit

SESSION_TTL = timedelta(days=30)
# How long the refresh token a session just rotated away from still works:
# two tabs refreshing at once send the same token, and only one rotates it.
ROTATION_GRACE = timedelta(seconds=60)


def allowed_return_origin(
    value: str | None, origins: list[str], origin_regex: str | None
) -> str | None:
    """The origin to send the user back to after signing in, or None when
    `value` isn't one of the frontend's origins (the same list CORS allows).
    Only a bare origin is accepted, never a path, so a sign-in can't be
    turned into a redirect to an arbitrary page."""
    if not value:
        return None
    parts = urlsplit(value.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    if parts.path not in ("", "/") or parts.query or parts.fragment or "@" in parts.netloc:
        return None
    origin = f"{parts.scheme}://{parts.netloc}".lower()
    if origin in (allowed.lower() for allowed in origins):
        return origin
    if origin_regex and re.fullmatch(origin_regex, origin):
        return origin
    return None


class RefreshOutcome(StrEnum):
    """What `/auth/refresh` does with the token it was sent."""

    ROTATE = "rotate"  # The current token: issue a new one and an access token.
    GRACE = "grace"  # Rotated away seconds ago: an access token, no new cookie.
    REUSE = "reuse"  # An old token sent again: likely stolen, end the session.
    REFUSE = "refuse"  # Unknown, expired or signed out.


def refresh_outcome(
    *,
    matched_current: bool,
    revoked_at: datetime | None,
    expires_at: datetime,
    rotated_at: datetime | None,
    now: datetime,
) -> RefreshOutcome:
    """Decides on a token that matched a session, either its current one
    (`matched_current`) or the one before it."""
    if revoked_at is not None or expires_at <= now:
        return RefreshOutcome.REFUSE
    if matched_current:
        return RefreshOutcome.ROTATE
    if rotated_at is not None and now - rotated_at <= ROTATION_GRACE:
        return RefreshOutcome.GRACE
    return RefreshOutcome.REUSE
