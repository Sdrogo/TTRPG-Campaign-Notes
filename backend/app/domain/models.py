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


@dataclass(frozen=True)
class DocumentOwner:
    document_id: uuid.UUID
    user_id: uuid.UUID
