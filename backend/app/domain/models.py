import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class RoomRole(StrEnum):
    MASTER = "master"
    PLAYER = "player"


class RoomStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


@dataclass(frozen=True)
class Room:
    id: uuid.UUID
    name: str
    game_system: str | None
    status: RoomStatus
    created_by: uuid.UUID
    players_can_create_documents: bool = True


@dataclass(frozen=True)
class Membership:
    id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    role: RoomRole
    is_admin: bool


@dataclass(frozen=True)
class Tag:
    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    category: str | None


@dataclass(frozen=True)
class Invitation:
    id: uuid.UUID
    room_id: uuid.UUID
    code: str
    role: RoomRole
    created_by: uuid.UUID
    expires_at: datetime | None
    revoked_at: datetime | None


@dataclass(frozen=True)
class AuditLogEntry:
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
    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    visibility: DocumentVisibility
    created_by: uuid.UUID


@dataclass(frozen=True)
class DocumentImage:
    id: uuid.UUID
    document_id: uuid.UUID
    storage_path: str
    created_by: uuid.UUID
    # Set when the image was attached to a Comment: it's still one of the
    # Document's images, but only visible to whoever sees that Comment.
    post_id: uuid.UUID | None = None


@dataclass(frozen=True)
class DocumentOwner:
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
