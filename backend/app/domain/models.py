"""The domain's data types: frozen dataclasses and enums, independent of how
they are stored (app/db/models.py maps them to tables)."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class RoomRole(StrEnum):
    """A member's role, per Room (D-06). Being an Administrator is a separate
    flag, not a role (D-11)."""

    MASTER = "master"
    PLAYER = "player"


class RoomStatus(StrEnum):
    """Whether a Room is in use or archived (FR-R1)."""

    ACTIVE = "active"
    ARCHIVED = "archived"


@dataclass(frozen=True)
class Room:
    """A campaign space (FR-R1). `players_can_create_documents` is the Master's
    switch for Players' Document creation (D-13, FR-D7)."""

    id: uuid.UUID
    name: str
    game_system: str | None
    status: RoomStatus
    created_by: uuid.UUID
    players_can_create_documents: bool = True


@dataclass(frozen=True)
class Membership:
    """A user's place in one Room: their role and whether they are an
    Administrator (D-06, D-11)."""

    id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    role: RoomRole
    is_admin: bool


@dataclass(frozen=True)
class Tag:
    """A Room's label for classifying Documents, with an optional category
    (D-14, FR-N1)."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    category: str | None


@dataclass(frozen=True)
class Invitation:
    """A code for joining a Room with a proposed role (FR-R2). It stops working
    once expired or revoked."""

    id: uuid.UUID
    room_id: uuid.UUID
    code: str
    role: RoomRole
    created_by: uuid.UUID
    expires_at: datetime | None
    revoked_at: datetime | None


@dataclass(frozen=True)
class AuditLogEntry:
    """A record of a visibility change, role change or Ownership transfer
    (VR-08), written in the same transaction as the change (Invariant 7).
    `details` holds the before/after values."""

    id: uuid.UUID
    room_id: uuid.UUID
    actor_user_id: uuid.UUID
    target_user_id: uuid.UUID | None
    action: str
    details: dict[str, object]


class DocumentVisibility(StrEnum):
    """Section 8 of requirements.md. ROOM = every member; MASTER = Master
    only; PRIVATE = Owners + Master; SELECTIVE = Owners + Master + an
    explicit grant list."""

    ROOM = "room"
    MASTER = "master"
    PRIVATE = "private"
    SELECTIVE = "selective"


@dataclass(frozen=True)
class Document:
    """A campaign entry - an NPC, a place, an event... (D-05, D-09). Its
    Owners, Tags, images and grants are stored separately."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    visibility: DocumentVisibility
    created_by: uuid.UUID


@dataclass(frozen=True)
class DocumentImage:
    """An image in a Document's gallery, stored in Supabase Storage under
    `storage_path`; only the path lives in Postgres."""

    id: uuid.UUID
    document_id: uuid.UUID
    storage_path: str
    created_by: uuid.UUID
    # Set when the image was attached to a Comment: it's still one of the
    # Document's images, but only visible to whoever sees that Comment.
    post_id: uuid.UUID | None = None
    # The one image an Owner picked to lead the Document (spec 07). At most
    # one per Document, enforced by a partial unique index.
    is_favorite: bool = False


@dataclass(frozen=True)
class DocumentOwner:
    """An explicit Owner of a Document (D-12). The Master is an implicit Owner
    of every Document and has no row."""

    document_id: uuid.UUID
    user_id: uuid.UUID


class PostKind(StrEnum):
    """requirements.md's Post model: a Thread contribution is either a
    Comment or a (titled) Detail. Only Comments are implemented so far."""

    COMMENT = "comment"


@dataclass(frozen=True)
class Comment:
    """A Post of kind Comment in a Document's one main Thread (D-20, FR-T1).
    Its visibility uses the same section-8 levels as a Document (VR-03),
    with the author standing in for the Owner. A deleted Comment keeps its
    row with an empty body so the conversation isn't broken (FR-T5)."""

    id: uuid.UUID
    document_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    visibility: DocumentVisibility
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


@dataclass(frozen=True)
class UserProfile:
    """What a user chose to show about themselves (FR-A2). Every field is
    optional: a user who never opened the Account page is shown by email."""

    user_id: uuid.UUID
    email: str | None = None
    display_name: str | None = None
    pronouns: str | None = None
    bio: str | None = None
    avatar_path: str | None = None
    # Whether the Google name/picture were already offered as defaults. They
    # are copied once; after that the profile is entirely the user's.
    google_prefilled: bool = False
