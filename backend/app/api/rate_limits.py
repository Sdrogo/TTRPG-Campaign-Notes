"""Per-user rate limits on the heavy routes (spec 72 Decision 10). Each group
is a dependency added to its routes' decorators; the general limit on every
write lives in `app/auth/dependencies.py::get_current_user`, which every
protected route already runs. Limits sized so the bulk uploads keep working:
a vault import is one preview and one import request, and Document images
go one request per file (spec 72, "Bulk uploads stay inside these limits")."""

from enum import StrEnum
from typing import Any

from fastapi import Depends

from app.auth.dependencies import CurrentUserDep, rate_limited
from app.domain.throttle import RateLimitedError, Throttle
from app.i18n.dependencies import LocaleDep

MINUTE = 60.0


class Group(StrEnum):
    """The route groups of Decision 10, each with its own window."""

    UPLOAD = "upload"
    IMPORT_PREVIEW = "import_preview"
    IMPORT = "import"
    EXPORT = "export"
    DUPLICATE = "duplicate"
    INVITE = "invite"


THROTTLES: dict[Group, Throttle] = {
    Group.UPLOAD: Throttle(limit=120, window=MINUTE),
    Group.IMPORT_PREVIEW: Throttle(limit=30, window=10 * MINUTE),
    Group.IMPORT: Throttle(limit=10, window=10 * MINUTE),
    Group.EXPORT: Throttle(limit=20, window=10 * MINUTE),
    Group.DUPLICATE: Throttle(limit=5, window=10 * MINUTE),
    Group.INVITE: Throttle(limit=30, window=60 * MINUTE),
}


def limit(group: Group) -> Any:
    """The dependency that counts a call against `group` for the caller (429
    over it). Counted by user id, after authentication."""
    throttle = THROTTLES[group]

    async def _check(current_user: CurrentUserDep, locale: LocaleDep) -> None:
        try:
            throttle.check(current_user.id)
        except RateLimitedError as exc:
            raise rate_limited(exc, locale) from exc

    return Depends(_check)


def reset_all() -> None:
    """Forgets every count, the general write limit's included (tests)."""
    from app.auth.dependencies import WRITE_THROTTLE

    for throttle in THROTTLES.values():
        throttle.reset()
    WRITE_THROTTLE.reset()
