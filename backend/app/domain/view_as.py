"""Viewing the Room as one of its members (FR-V3, spec 22b): the Master
browses read-only with that member's visibility. The rules for who may, and
that nothing is written meanwhile, live here; the auth dependency applies
them once per request so every read path follows the member's view."""

from app.domain.errors import DomainError
from app.domain.models import Membership, RoomRole

# The methods that only read. Anything else carrying the header is refused.
READ_METHODS = frozenset({"GET", "HEAD"})


class ViewAsReadOnlyError(DomainError):
    """A write was sent while viewing as someone else (spec 22b Decision 3)."""


class OnlyMasterViewsAsError(DomainError):
    """Only the Master of the Room views it as a member (Decision 2)."""


class ViewAsNotAMemberError(DomainError):
    """The member to view as isn't (or is no longer) in the Room."""


def ensure_read_only(method: str) -> None:
    """Refuses any request that isn't a read."""
    if method.upper() not in READ_METHODS:
        raise ViewAsReadOnlyError("errors.viewAs.readOnly")


def ensure_can_view_as(viewer: Membership, target: Membership | None) -> Membership:
    """The member to view as, once the caller is known to be the Master and
    the target a current member of the same Room."""
    if viewer.role != RoomRole.MASTER:
        raise OnlyMasterViewsAsError("errors.viewAs.onlyMaster")
    if target is None or target.room_id != viewer.room_id:
        raise ViewAsNotAMemberError("errors.viewAs.notAMember")
    return target
