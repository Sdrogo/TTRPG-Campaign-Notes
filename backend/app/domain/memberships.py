"""Rules for changing a Room's members (UC-05, UC-19): role and Administrator
changes, removals and leaving, all guarded so a Room always keeps a Master and
an Administrator (D-16, Invariant 5)."""

import uuid
from dataclasses import dataclass

from app.domain.models import AuditLogEntry, Membership, RoomRole


class MemberNotFoundError(Exception):
    """The target user isn't a member of the Room."""


class LastMasterError(Exception):
    """The change would leave the Room without a Master (D-16)."""


class LastAdministratorError(Exception):
    """The change would leave the Room without an Administrator (D-16,
    FR-R7)."""


class NoChangeRequestedError(Exception):
    """The request set neither the role nor the Administrator flag."""


@dataclass(frozen=True)
class MembershipChangePlan:
    """The updated Membership and its audit entry, written in the same
    transaction (Invariant 7)."""

    membership: Membership
    audit_entry: AuditLogEntry


def _find_membership(memberships: list[Membership], user_id: uuid.UUID) -> Membership:
    """The Membership of `user_id`, or `MemberNotFoundError`."""
    target = next((m for m in memberships if m.user_id == user_id), None)
    if target is None:
        raise MemberNotFoundError("User is not a member of this room")
    return target


def _ensure_successor_exists(
    target: Membership,
    others: list[Membership],
    resolved_role: RoomRole,
    resolved_is_admin: bool,
) -> None:
    """D-16 / Invariant 5: a Room can never end up without a Master or an
    Administrator - checked against every OTHER member, since the target's
    own post-change state is what `resolved_role`/`resolved_is_admin` say."""
    losing_master = target.role == RoomRole.MASTER and resolved_role != RoomRole.MASTER
    if losing_master and not any(m.role == RoomRole.MASTER for m in others):
        raise LastMasterError("Cannot remove the last Master without a successor")

    losing_admin = target.is_admin and not resolved_is_admin
    if losing_admin and not any(m.is_admin for m in others):
        raise LastAdministratorError("Cannot remove the last Administrator without a successor")


def plan_role_change(
    memberships: list[Membership],
    target_user_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    new_role: RoomRole | None,
    new_is_admin: bool | None,
) -> MembershipChangePlan:
    """UC-05 / FR-R4, FR-R5: an Administrator changes a member's role and/or
    Administrator flag. 'Designating a new Master' is just setting
    role=master on someone via this same function."""
    if new_role is None and new_is_admin is None:
        raise NoChangeRequestedError("Request must change the role and/or the admin flag")

    target = _find_membership(memberships, target_user_id)
    others = [m for m in memberships if m.user_id != target_user_id]

    resolved_role = new_role if new_role is not None else target.role
    resolved_is_admin = new_is_admin if new_is_admin is not None else target.is_admin

    _ensure_successor_exists(target, others, resolved_role, resolved_is_admin)

    updated = Membership(
        id=target.id,
        room_id=target.room_id,
        user_id=target.user_id,
        role=resolved_role,
        is_admin=resolved_is_admin,
    )
    audit_entry = AuditLogEntry(
        id=uuid.uuid4(),
        room_id=target.room_id,
        actor_user_id=actor_user_id,
        target_user_id=target.user_id,
        action="role_change",
        details={
            "from_role": target.role.value,
            "to_role": resolved_role.value,
            "from_is_admin": target.is_admin,
            "to_is_admin": resolved_is_admin,
        },
    )
    return MembershipChangePlan(membership=updated, audit_entry=audit_entry)


def plan_removal(
    memberships: list[Membership],
    target_user_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    is_self: bool,
) -> AuditLogEntry:
    """UC-05 (Administrator removes a member) and UC-19 (a member leaves) -
    both funnel through here since D-16's guard is identical either way."""
    target = _find_membership(memberships, target_user_id)
    others = [m for m in memberships if m.user_id != target_user_id]

    _ensure_successor_exists(target, others, resolved_role=RoomRole.PLAYER, resolved_is_admin=False)

    return AuditLogEntry(
        id=uuid.uuid4(),
        room_id=target.room_id,
        actor_user_id=actor_user_id,
        target_user_id=target.user_id,
        action="member_left" if is_self else "member_removed",
        details={"role": target.role.value, "is_admin": target.is_admin},
    )
