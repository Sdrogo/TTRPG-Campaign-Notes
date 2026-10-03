"""The Reveal action (FR-V2, VR-06, UC-13, spec 22): the Master widens who sees
a Document, a Note or a Comment in one deliberate step, and the members who
just gained access are told. Reveal only widens; narrowing stays an ordinary
edit. Who sees what is still decided by `visibility.py`: this module only
plans the new level and works out who gains it."""

import uuid
from collections.abc import Callable, Collection
from dataclasses import dataclass
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.models import (
    AuditLogEntry,
    Comment,
    ContentKind,
    DocumentVisibility,
    Membership,
    Reveal,
    RoomRole,
)
from app.domain.visibility import is_content_visible

# One AuditLog action per kind of content (VR-06, Invariant 7).
REVEAL_ACTIONS: dict[ContentKind, str] = {
    ContentKind.DOCUMENT: "document_revealed",
    ContentKind.NOTE: "note_revealed",
    ContentKind.COMMENT: "comment_revealed",
}


class OnlyMasterRevealsError(DomainError):
    """Only the Master reveals content (spec 22 Decision 1)."""


class RevealAudienceRequiredError(DomainError):
    """The request names neither the whole Room nor any member."""


class RevealNotWideningError(DomainError):
    """The new audience isn't strictly wider than the current one: nobody
    would gain access, so there is nothing to reveal."""


class RevealDeletedCommentError(DomainError):
    """A deleted Comment is an empty placeholder: there is nothing to
    reveal."""


@dataclass(frozen=True)
class RevealAudience:
    """Who the Master reveals to: the whole Room, or these members added to
    the current audience (spec 22 Decision 1)."""

    to_room: bool
    user_ids: frozenset[uuid.UUID] = frozenset()


@dataclass(frozen=True)
class RevealTarget:
    """The content being revealed. `owner_ids` are who "Private" means for it
    (the Document's Owners for a Document or a Note, the author for a
    Comment); `always_visible_to` are those who see it whatever its level
    (a Comment's author, VR-02)."""

    kind: ContentKind
    document_id: uuid.UUID
    note_id: uuid.UUID | None = None
    comment_id: uuid.UUID | None = None
    author_id: uuid.UUID | None = None
    owner_ids: frozenset[uuid.UUID] = frozenset()
    always_visible_to: frozenset[uuid.UUID] = frozenset()


# Whether a member sees the content at the given level and grants, everything
# around it included: the Document a Note or a Comment is on, and the
# Comments above a reply (spec 19). The API builds it from `visibility.py`.
EffectiveSees = Callable[[Membership, DocumentVisibility, Collection[uuid.UUID]], bool]


@dataclass(frozen=True)
class RevealPlan:
    """What a Reveal writes, in one transaction: the content's new level and
    grants, the Reveal with its recipients, and the AuditLog row (VR-06)."""

    visibility: DocumentVisibility
    selective_user_ids: frozenset[uuid.UUID]
    reveal: Reveal
    recipients: frozenset[uuid.UUID]
    audit_entry: AuditLogEntry


def ensure_can_reveal(role: RoomRole) -> None:
    """Raises `OnlyMasterRevealsError` unless the requester is the Master
    (spec 22 Decision 1) - checked before anything changes (Invariant 6)."""
    if role != RoomRole.MASTER:
        raise OnlyMasterRevealsError("errors.reveal.onlyMaster")


def ensure_comment_revealable(comment: Comment) -> None:
    """Raises `RevealDeletedCommentError` for a deleted placeholder: its text
    is gone, so there is nothing to reveal."""
    if comment.deleted_at is not None:
        raise RevealDeletedCommentError("errors.reveal.commentDeleted")


def revealed_level(
    visibility: DocumentVisibility,
    selective_user_ids: Collection[uuid.UUID],
    audience: RevealAudience,
) -> tuple[DocumentVisibility, frozenset[uuid.UUID]]:
    """The level and grants after revealing to `audience`. To the Room: Room.
    To chosen members: they are added to a Selective grant list, and a Master
    or Private level becomes Selective with just them - which keeps whoever
    "Private" let in (Selective includes the Owners) and so only ever
    widens. Content already at Room stays there."""
    if audience.to_room or visibility == DocumentVisibility.ROOM:
        return DocumentVisibility.ROOM, frozenset()
    if visibility == DocumentVisibility.SELECTIVE:
        return DocumentVisibility.SELECTIVE, frozenset(selective_user_ids) | audience.user_ids
    return DocumentVisibility.SELECTIVE, audience.user_ids


def _own_audience(
    target: RevealTarget,
    visibility: DocumentVisibility,
    selective_user_ids: Collection[uuid.UUID],
    members: Collection[Membership],
) -> frozenset[uuid.UUID]:
    """Who sees the content on its own, at this level (section 8)."""
    return frozenset(
        member.user_id
        for member in members
        if member.user_id in target.always_visible_to
        or is_content_visible(
            visibility, member.user_id, member.role, target.owner_ids, selective_user_ids
        )
    )


def plan_reveal(
    target: RevealTarget,
    visibility: DocumentVisibility,
    selective_user_ids: Collection[uuid.UUID],
    audience: RevealAudience,
    members: Collection[Membership],
    effective_sees: EffectiveSees,
    room_id: uuid.UUID,
    revealer_id: uuid.UUID,
    now: datetime,
) -> RevealPlan:
    """Plans one Reveal (VR-06, UC-13). Refuses anything that isn't a strict
    widening of the content's own audience (422). The **recipients** are the
    members who see it afterwards and didn't before, everything around it
    included (`effective_sees`): a Note on a Document they can't see, or a
    reply under a Comment hidden from them, gains them nothing. The Master
    and a Comment's author always saw it, so they are never recipients. The
    caller has checked the requester is the Master and every chosen member
    belongs to the Room."""
    if not audience.to_room and not audience.user_ids:
        raise RevealAudienceRequiredError("errors.reveal.audienceRequired")

    new_visibility, new_grants = revealed_level(visibility, selective_user_ids, audience)
    before = _own_audience(target, visibility, selective_user_ids, members)
    after = _own_audience(target, new_visibility, new_grants, members)
    if not after > before:
        raise RevealNotWideningError("errors.reveal.notWidening")

    recipients = frozenset(
        member.user_id
        for member in members
        if member.user_id != revealer_id
        and effective_sees(member, new_visibility, new_grants)
        and not effective_sees(member, visibility, selective_user_ids)
    )
    reveal = Reveal(
        id=uuid.uuid4(),
        room_id=room_id,
        kind=target.kind,
        document_id=target.document_id,
        note_id=target.note_id,
        comment_id=target.comment_id,
        revealed_by=revealer_id,
        revealed_at=now,
    )
    details: dict[str, object] = {
        "reveal_id": str(reveal.id),
        "document_id": str(target.document_id),
        "from": visibility.value,
        "to": new_visibility.value,
        "selective_user_ids": sorted(str(user_id) for user_id in new_grants),
        "recipient_ids": sorted(str(user_id) for user_id in recipients),
    }
    if target.note_id is not None:
        details["note_id"] = str(target.note_id)
    if target.comment_id is not None:
        details["comment_id"] = str(target.comment_id)
    audit_entry = AuditLogEntry(
        id=uuid.uuid4(),
        room_id=room_id,
        actor_user_id=revealer_id,
        target_user_id=target.author_id,
        action=REVEAL_ACTIONS[target.kind],
        details=details,
    )
    return RevealPlan(
        visibility=new_visibility,
        selective_user_ids=new_grants,
        reveal=reveal,
        recipients=recipients,
        audit_entry=audit_entry,
    )


def unseen_reveals_once(reveals: Collection[Reveal]) -> list[Reveal]:
    """One entry per piece of content, the latest Reveal of it, newest first:
    content hidden again and revealed once more counts once (spec 22
    Decision 3)."""
    latest: dict[tuple[ContentKind, uuid.UUID], Reveal] = {}
    for reveal in reveals:
        key = (reveal.kind, content_id(reveal))
        current = latest.get(key)
        if current is None or reveal.revealed_at > current.revealed_at:
            latest[key] = reveal
    return sorted(latest.values(), key=lambda r: (r.revealed_at, r.id), reverse=True)


def content_id(reveal: Reveal) -> uuid.UUID:
    """The id of what was revealed: the Note, the Comment or the Document."""
    return reveal.note_id or reveal.comment_id or reveal.document_id
