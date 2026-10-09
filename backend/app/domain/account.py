"""Deleting one's own account (spec 31_1, GDPR art. 17): which Rooms go with
the account, which ones the user leaves, and the D-16 guard that stops the
whole deletion while a Room would be left without a Master or an
Administrator."""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.domain.errors import DomainError
from app.domain.memberships import LastAdministratorError, LastMasterError, plan_removal
from app.domain.models import AuditLogEntry, Membership

# What the user types to confirm the deletion. Fixed and language-neutral, so
# the check doesn't depend on the app language.
DELETION_CONFIRMATION = "DELETE"


class DeletionNotConfirmedError(DomainError):
    """The request didn't carry `DELETION_CONFIRMATION`."""


class SuccessorNeededError(DomainError):
    """The user is the last Master or Administrator of a Room that has other
    members (D-16): they must hand the role over first. `rooms` names every
    such Room, so they can settle them all in one go."""


@dataclass(frozen=True)
class AccountErasurePlan:
    """The Rooms deleted outright (the user was their only member) and, for
    every other Room, the audit entry of the user leaving it (Invariant 7)."""

    rooms_to_delete: list[uuid.UUID]
    departures: list[AuditLogEntry]


def ensure_confirmed(confirmation: str) -> None:
    """Refuses a deletion request without the exact confirmation word, so a
    stray call can't erase an account."""
    if confirmation != DELETION_CONFIRMATION:
        raise DeletionNotConfirmedError("errors.account.deletionNotConfirmed")


def plan_account_erasure(
    user_id: uuid.UUID,
    memberships_by_room: Mapping[uuid.UUID, Sequence[Membership]],
    room_names: Mapping[uuid.UUID, str],
) -> AccountErasurePlan:
    """Spec 31_1 Decision 2: a Room whose only member is the user is deleted
    with the account; any other Room is left as a member leaves it (UC-19),
    which needs a successor Master and Administrator (D-16). Every Room that
    lacks one is collected before refusing, sorted by name."""
    rooms_to_delete: list[uuid.UUID] = []
    departures: list[AuditLogEntry] = []
    blocked: list[str] = []
    for room_id, memberships in memberships_by_room.items():
        if all(m.user_id == user_id for m in memberships):
            rooms_to_delete.append(room_id)
            continue
        try:
            departures.append(plan_removal(list(memberships), user_id, user_id, is_self=True))
        except (LastMasterError, LastAdministratorError):
            blocked.append(room_names.get(room_id, str(room_id)))
    if blocked:
        raise SuccessorNeededError(
            "errors.account.successorNeeded", rooms=", ".join(sorted(blocked, key=str.casefold))
        )
    return AccountErasurePlan(rooms_to_delete=rooms_to_delete, departures=departures)
