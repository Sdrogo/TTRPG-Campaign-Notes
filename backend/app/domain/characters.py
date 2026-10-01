"""Rules for Characters (D-23 to D-25, spec 17): who plays a Document, who may
write a Comment as it, and who gets to see that a Comment was written in
character."""

import uuid
from collections.abc import Collection, Iterable
from dataclasses import dataclass, replace

from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, Comment, Document, DocumentOwner, RoomRole

CHARACTER_PLAYER_CHANGED = "character_player_changed"
DOCUMENT_OWNER_ADDED = "document_owner_added"


class PlayerNotAMemberError(DomainError):
    """The chosen Character player isn't a member of the Room (UC-21)."""


class CannotPostAsError(DomainError):
    """The author neither plays this Character nor is the Master (D-24)."""


@dataclass(frozen=True)
class PlayerChangePlan:
    """The Document with its new Character player, the Owner row to add when
    the player is also made an Owner, and the AuditLog rows to write with
    them (Invariant 7)."""

    document: Document
    new_owner: DocumentOwner | None
    audit_entries: list[AuditLogEntry]


def plan_player_change(
    document: Document,
    actor_id: uuid.UUID,
    owner_ids: Collection[uuid.UUID],
    member_ids: Collection[uuid.UUID],
    new_player_id: uuid.UUID | None,
    add_as_owner: bool,
) -> PlayerChangePlan:
    """UC-21/FR-D9: links the Document to one member of the Room, or unlinks
    it with None (D-23: at most one player; the player doesn't confirm). The
    caller has already checked the actor is an Owner or the Master (D-12).

    `add_as_owner` also makes the player an explicit Owner, so they can edit
    their sheet; it does nothing when unlinking or when they already own it.
    A real change of player and an added Owner are each audited (FR-D9,
    Invariant 7); a request that changes nothing writes nothing."""
    if new_player_id is not None and new_player_id not in member_ids:
        raise PlayerNotAMemberError("errors.character.playerNotAMember")

    audit_entries: list[AuditLogEntry] = []
    if new_player_id != document.played_by:
        audit_entries.append(
            AuditLogEntry(
                id=uuid.uuid4(),
                room_id=document.room_id,
                actor_user_id=actor_id,
                target_user_id=new_player_id,
                action=CHARACTER_PLAYER_CHANGED,
                details={
                    "document_id": str(document.id),
                    "from": None if document.played_by is None else str(document.played_by),
                    "to": None if new_player_id is None else str(new_player_id),
                },
            )
        )

    new_owner = None
    if add_as_owner and new_player_id is not None and new_player_id not in owner_ids:
        new_owner = DocumentOwner(document_id=document.id, user_id=new_player_id)
        audit_entries.append(
            AuditLogEntry(
                id=uuid.uuid4(),
                room_id=document.room_id,
                actor_user_id=actor_id,
                target_user_id=new_player_id,
                action=DOCUMENT_OWNER_ADDED,
                details={"document_id": str(document.id), "reason": "character_player"},
            )
        )

    return PlayerChangePlan(
        document=replace(document, played_by=new_player_id),
        new_owner=new_owner,
        audit_entries=audit_entries,
    )


def can_post_as(document: Document, user_id: uuid.UUID, role: RoomRole) -> bool:
    """D-24: a member writes as the Characters they play; the Master writes
    as any Document of the Room, to give NPCs a voice. The caller has already
    checked the Document is in the Room and visible to the author."""
    return role == RoomRole.MASTER or document.played_by == user_id


def ensure_can_post_as(document: Document, user_id: uuid.UUID, role: RoomRole) -> None:
    """`can_post_as`, raising `CannotPostAsError` (403) when it says no."""
    if not can_post_as(document, user_id, role):
        raise CannotPostAsError("errors.character.cannotPostAs")


def postable_characters(
    documents: Iterable[Document], user_id: uuid.UUID, role: RoomRole
) -> list[Document]:
    """The Documents, among those the user already sees, they may write as
    (D-24), sorted by name for the composer's picker."""
    allowed = [document for document in documents if can_post_as(document, user_id, role)]
    return sorted(allowed, key=lambda document: (document.name.casefold(), str(document.id)))


def character_shown_to(
    comment: Comment, visible_document_ids: Collection[uuid.UUID]
) -> uuid.UUID | None:
    """VR-13/D-25: the Character a Comment shows to this viewer - its
    `as_document_id` only when the viewer sees that Document, otherwise None,
    so a hidden Character's name never leaks through a Comment (I-13). The
    viewer then sees the real author, as for any Comment."""
    if comment.as_document_id is None or comment.as_document_id not in visible_document_ids:
        return None
    return comment.as_document_id
