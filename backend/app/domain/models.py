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
