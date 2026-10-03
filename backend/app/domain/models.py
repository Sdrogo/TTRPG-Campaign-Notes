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
    (D-14, FR-N1). A non-None `main_position` makes it one of the Room's Main
    Tags (spec 11): Documents group by them, in ascending position."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    category: str | None
    main_position: int | None = None


@dataclass(frozen=True)
class TagCombination:
    """Two or more Tags a Room groups its Documents list by together (spec
    11_2): a Document belongs to it when it carries all of them. `position`
    shares the numbering of the single Main Tags' `main_position`."""

    id: uuid.UUID
    room_id: uuid.UUID
    position: int
    tag_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True)
class Invitation:
    """A code for joining a Room with a proposed role (FR-R2). It stops working
    once expired or revoked. A direct invitation (FR-F5) has an `invitee_id`:
    only that user may accept it, and it is listed for them."""

    id: uuid.UUID
    room_id: uuid.UUID
    code: str
    role: RoomRole
    created_by: uuid.UUID
    expires_at: datetime | None
    revoked_at: datetime | None
    invitee_id: uuid.UUID | None = None


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


class PromotionTarget(StrEnum):
    """Where a promoted Comment's text went (spec 19c Decision 5)."""

    DESCRIPTION = "description"
    DOCUMENT = "document"


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
    # Set when the Document is a Character: the member of the Room who plays
    # it (D-23). A relation like Ownership, not a type (D-05).
    played_by: uuid.UUID | None = None


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
class DocumentFile:
    """A PDF Attachment on a Document (D-21, spec 16), stored in Supabase
    Storage under `storage_path`; only the path lives in Postgres. It has no
    visibility of its own: whoever sees the Document sees it (VR-12)."""

    id: uuid.UUID
    document_id: uuid.UUID
    storage_path: str
    # The uploaded file's own name, cleaned up, shown in the UI and used as
    # the download name. The Storage object's name is random.
    display_name: str
    size_bytes: int
    content_type: str
    uploaded_by: uuid.UUID
    created_at: datetime


@dataclass(frozen=True)
class DocumentOwner:
    """An explicit Owner of a Document (D-12). The Master is an implicit Owner
    of every Document and has no row."""

    document_id: uuid.UUID
    user_id: uuid.UUID


@dataclass(frozen=True)
class Note:
    """An additional block of information on a Document, with a title, a
    description and a visibility of its own (spec 12, VR-03). A Note is what
    requirements.md calls a Detail (D-18), stored in its own table and managed
    by the Document's Owners and the Master rather than written by any member
    as a Thread Post (a deliberate departure from D-19). `position` orders a
    Document's Notes, ascending."""

    id: uuid.UUID
    document_id: uuid.UUID
    title: str
    description: str
    visibility: DocumentVisibility
    position: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PostKind(StrEnum):
    """requirements.md's Post model: a Thread contribution is either a
    Comment or a (titled) Detail. Only Comments are Posts: Details are
    implemented as Notes, in their own table (see `Note`)."""

    COMMENT = "comment"


@dataclass(frozen=True)
class Comment:
    """A Post of kind Comment in a Document's one main Thread (D-20, FR-T1).
    Its visibility uses the same section-8 levels as a Document (VR-03),
    with the author standing in for the Owner. A deleted Comment keeps its
    row with an empty body so the conversation isn't broken (FR-T5). A
    Comment may answer another one (`parent_id`), so a Thread is a tree."""

    id: uuid.UUID
    document_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    visibility: DocumentVisibility
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    # The Character (a Document of the same Room) the author wrote this as
    # (D-24). Shown only to viewers who see that Document (VR-13).
    as_document_id: uuid.UUID | None = None
    # The Comment this one answers (spec 19, FR-T1), None for a top-level
    # Comment. A reply is seen only by who sees its parent too (D-17).
    parent_id: uuid.UUID | None = None
    # When an Owner or the Master pinned this top-level Comment (spec 19c
    # Decision 3); pinned Comments are shown first, oldest pin first.
    pinned_at: datetime | None = None
    # When, and by whom, this top-level Comment's branch was marked resolved
    # (spec 19c Decision 4); both None while it is open.
    resolved_at: datetime | None = None
    resolved_by: uuid.UUID | None = None
    # When, by whom and where the Comment's text was promoted (spec 19c
    # Decision 5, FR-T8): into its Document's description, or into a new
    # Document (`promoted_document_id`). The latest promotion wins.
    promoted_at: datetime | None = None
    promoted_by: uuid.UUID | None = None
    promoted_to: PromotionTarget | None = None
    promoted_document_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Reaction:
    """One member's emoji on a Comment (spec 19c, FR-T6). A member reacts at
    most once with each emoji on a Comment."""

    comment_id: uuid.UUID
    user_id: uuid.UUID
    emoji: str
    created_at: datetime


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


class FriendshipStatus(StrEnum):
    """Where a Friendship stands (D-26). A declined one is kept for the
    request cooldown (D-27)."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"


@dataclass(frozen=True)
class Friendship:
    """A Friendship or a request for one between two users, independent of
    any Room (D-26). The pair is stored ordered (`user_low` < `user_high`) so
    there is one row per pair whoever asked; `requested_by` is the sender of
    the current request and the other user is the only one who may answer
    it. `hidden_from_sender` is set when the sender cancels a request that
    was silently declined: the row stays for the cooldown (spec 18)."""

    id: uuid.UUID
    user_low: uuid.UUID
    user_high: uuid.UUID
    requested_by: uuid.UUID
    status: FriendshipStatus
    created_at: datetime
    responded_at: datetime | None = None
    hidden_from_sender: bool = False

    @property
    def recipient(self) -> uuid.UUID:
        """The user the current request was sent to."""
        return self.other(self.requested_by)

    def involves(self, user_id: uuid.UUID) -> bool:
        """Whether `user_id` is one of the pair."""
        return user_id in (self.user_low, self.user_high)

    def other(self, user_id: uuid.UUID) -> uuid.UUID:
        """The other user of the pair, seen from `user_id` (one of the two)."""
        return self.user_high if user_id == self.user_low else self.user_low


@dataclass(frozen=True)
class FriendCode:
    """A user's personal code for receiving Friendship requests without
    sharing a Room (D-27, FR-F4). One per user; regenerating replaces it."""

    user_id: uuid.UUID
    code: str
    created_at: datetime


class MentionSourceKind(StrEnum):
    """Where in a Document a mention is written (spec 20)."""

    DESCRIPTION = "description"
    NOTE = "note"
    COMMENT = "comment"


@dataclass(frozen=True)
class DocumentMention:
    """A backlink (spec 20): `source_document_id`'s description, one of its
    Notes (`note_id`) or one of its Comments (`comment_id`), as
    `source_kind` says, mentions a Document or a Tag (exactly one target),
    with the excerpt around the mention."""

    id: uuid.UUID
    source_document_id: uuid.UUID
    source_kind: MentionSourceKind
    note_id: uuid.UUID | None
    comment_id: uuid.UUID | None
    target_document_id: uuid.UUID | None
    target_tag_id: uuid.UUID | None
    excerpt: str


@dataclass(frozen=True)
class MentionSource:
    """One place mentions are written in (spec 20): a Document's description,
    or one of its Notes or Comments."""

    document_id: uuid.UUID
    kind: MentionSourceKind
    note_id: uuid.UUID | None = None
    comment_id: uuid.UUID | None = None
