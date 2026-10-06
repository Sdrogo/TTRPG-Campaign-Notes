"""SQLAlchemy table definitions. Alembic migrations (backend/migrations) are
generated from these; the repositories map rows to the domain dataclasses in
app/domain/models.py."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base of every table, and the metadata Alembic compares
    against."""


# Full-text search (spec 21, migration c4e9a7f1d3b2). One text search
# configuration for every language: `simple` (lower case, no stemming, no stop
# words) behind `unaccent`, since a Room mixes Italian and English. Each
# searchable table carries a generated `search_vector` with a GIN index; the
# column is deferred so ordinary reads never load it.
SEARCH_CONFIG = "public.search_simple_unaccent"


def _search_text(column: str) -> str:
    """SQL for `column` as a reader sees it: every mention token (spec 19c,
    20) replaced by its name, so `#[Drago](doc:<uuid>)` is indexed as
    "Drago" and never by its kind or id."""
    return (
        f"regexp_replace({column}, "
        r"'[@#]\[((?:[^]\\]|\\.)*)\]\((user|doc|tag):[0-9a-fA-F-]{36}\)', "
        r"'\1', 'g')"
    )


def _search_vector(column: str, weight: str | None = None) -> str:
    """SQL for the `tsvector` of `column` under `SEARCH_CONFIG`, weighted."""
    vector = f"to_tsvector('{SEARCH_CONFIG}'::regconfig, {_search_text(column)})"
    return vector if weight is None else f"setweight({vector}, '{weight}')"


def _search_index(table: str) -> Index:
    """The GIN index on a table's `search_vector`."""
    return Index(f"ix_{table}_search_vector", "search_vector", postgresql_using="gin")


# User ids (created_by / user_id below) intentionally have no DB-level FK to
# Supabase Auth's `auth.users` - see architecture.md's Backend Data Access
# note. The id always comes from a server-verified JWT `sub` claim
# (app/auth/), never from unchecked input, so the FK would only guard
# against a bug this app cannot have; it also couples our migrations to a
# schema we don't own and blocks integration tests from using synthetic
# user ids.


class RoomRow(Base):
    """A Room. Deleting it cascades to everything in it."""

    __tablename__ = "rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    game_system: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    players_can_create_documents: Mapped[bool] = mapped_column(Boolean, default=True)
    # The level new content starts at when a request names none (VR-05,
    # spec 22): room, master or private, never selective.
    default_visibility: Mapped[str] = mapped_column(
        String(20), server_default=text("'room'"), default="room"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MembershipRow(Base):
    """A user's role in a Room; unique per (room, user)."""

    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_membership_room_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    role: Mapped[str] = mapped_column(String(20))
    is_admin: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TagRow(Base):
    """A Room's Tag; names are unique within a Room."""

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("room_id", "name", name="uq_tag_room_name"),
        _search_index("tags"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(100))
    # Non-NULL = a Main Tag (spec 11); Documents group by these in ascending
    # order. A label like `category`, never a constraint: positions are
    # rewritten together, so gaps and ties are harmless.
    main_position: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed(_search_vector("name"), persisted=True), deferred=True
    )


class TagCombinationRow(Base):
    """A combination of Tags the Room groups Documents by (spec 11_2); its
    Tags are in `tag_combination_tags`."""

    __tablename__ = "tag_combinations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), index=True
    )
    # Same numbering as `TagRow.main_position`: singles and combinations
    # interleave in one order.
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TagCombinationTagRow(Base):
    """Links a combination to one of its Tags."""

    __tablename__ = "tag_combination_tags"

    combination_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tag_combinations.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class InvitationRow(Base):
    """A Room invitation, looked up by its unique `code`: a shareable link, or
    a direct invitation addressed to one user (`invitee_user_id`)."""

    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE")
    )
    code: Mapped[str] = mapped_column(String(64), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Set for a direct invitation to a Friend (FR-F5, spec 18_1b): only this
    # user may accept it. NULL for a shareable link.
    invitee_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)


class UserRow(Base):
    """A mirror of Supabase Auth's `auth.users` (id + email) plus the
    profile the user edits on the Account page, per architecture.md's
    Storage Model. Upserted opportunistically whenever a user creates a
    Room, accepts an invitation or edits their profile; see
    app/db/users_repo.py."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320))
    display_name: Mapped[str | None] = mapped_column(String(60))
    pronouns: Mapped[str | None] = mapped_column(String(40))
    bio: Mapped[str | None] = mapped_column(Text)
    # Storage path in the images bucket, like document_images.storage_path.
    avatar_path: Mapped[str | None] = mapped_column(String(500))
    # Set once the Google name/picture have been copied in as defaults.
    profile_prefilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLogRow(Base):
    """An audited change (Invariant 7), with its before/after values in
    `details`. Indexed by Room and time for the visibility history (spec
    22)."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_room_id_created_at", "room_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(50))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentRow(Base):
    """A Document. Its Owners, Tags, grants, images and Posts live in their own
    tables and cascade with it."""

    __tablename__ = "documents"
    __table_args__ = (_search_index("documents"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    visibility: Mapped[str] = mapped_column(String(20), default="room")
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    # The member who plays this Document as a Character (D-23, spec 17), or
    # None. Cleared when they leave the Room (D-15); no FK, like every user id.
    played_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Spec 21: the name weighs more than the description.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            f"{_search_vector('name', 'A')} || {_search_vector('description', 'B')}",
            persisted=True,
        ),
        deferred=True,
    )


class DocumentTagRow(Base):
    """Links a Document to one of its Tags."""

    __tablename__ = "document_tags"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class DocumentOwnerRow(Base):
    """An explicit Owner of a Document (D-12). The Master's implicit Ownership
    has no row."""

    __tablename__ = "document_owners"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)


class DocumentVisibilityGrantRow(Base):
    """A user who may see a Selective Document besides its Owners and the
    Master."""

    __tablename__ = "document_visibility_grants"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)


class NoteRow(Base):
    """A Note on a Document (spec 12): its own title, description and
    visibility. Not a Post - Notes belong to the Document, not its Thread."""

    __tablename__ = "document_notes"
    __table_args__ = (_search_index("document_notes"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    visibility: Mapped[str] = mapped_column(String(20), default="room")
    position: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Spec 21: the title weighs more than the text.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            f"{_search_vector('title', 'A')} || {_search_vector('description', 'B')}",
            persisted=True,
        ),
        deferred=True,
    )


class NoteVisibilityGrantRow(Base):
    """A user who may see a Selective Note besides the Document's Owners and
    the Master."""

    __tablename__ = "document_note_visibility_grants"

    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_notes.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)


class PostRow(Base):
    """A Post in a Document's main Thread (requirements.md's data model).
    There is no separate `threads` table: a Document has exactly one Thread
    (D-20/I-11), so a Post points straight at its Document. `kind` is only
    ever "comment": Details (D-18) are the Notes of `document_notes`."""

    __tablename__ = "posts"
    __table_args__ = (_search_index("posts"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(String(20), default="comment")
    body: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(20), default="room")
    # The Character this Post is written as (D-24, spec 17), or None. SET
    # NULL, not CASCADE: deleting the Character turns its Posts back into
    # plain ones, which shows the real author and so widens nothing.
    as_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    # The Post this one answers (spec 19, FR-T1), always of the same Document;
    # None for a top-level Comment.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Pin and resolution of a top-level Comment (spec 19c Decisions 3-4).
    # `resolved_by` names a user, so like `author_id` it has no foreign key
    # (no FK to `auth.users`, architecture.md -> Backend Data Access).
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # The latest promotion of the Comment's text (spec 19c Decision 5):
    # when, by whom, into what (`description` or `document`) and, for a new
    # Document, which one. SET NULL: deleting that Document keeps the mark.
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    promoted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    promoted_to: Mapped[str | None] = mapped_column(String(20))
    promoted_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    # Spec 21: NULL once deleted, so a placeholder is never found.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(f"CASE WHEN deleted_at IS NULL THEN {_search_vector('body')} END", persisted=True),
        deferred=True,
    )


class PostVisibilityGrantRow(Base):
    """A user who may see a Selective Post besides its author and the
    Master."""

    __tablename__ = "post_visibility_grants"

    post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)


class CommentReactionRow(Base):
    """One member's emoji on a Comment (spec 19c, FR-T6). The primary key
    lets a member use each emoji once per Comment; the emoji itself is
    checked by `app/domain/reactions.py::parse_emoji`. Goes with its Comment
    (CASCADE); deleting a Comment, which keeps its row, clears its reactions
    in the API."""

    __tablename__ = "comment_reactions"

    comment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DocumentMentionRow(Base):
    """A backlink (spec 20, FR-D4): a source (a Document's description, one of
    its Notes or one of its Comments) mentions a Document or a Tag of the
    same Room, with an excerpt around the mention. Rewritten whenever its
    source is saved; goes with the source Document, the Note, the Comment and
    the target (CASCADE). Exactly one target, and the source columns match
    `source_kind` (CHECKs)."""

    __tablename__ = "document_mentions"
    __table_args__ = (
        CheckConstraint(
            "(target_document_id IS NULL) <> (target_tag_id IS NULL)",
            name="ck_document_mentions_one_target",
        ),
        CheckConstraint(
            "(source_kind = 'description' AND note_id IS NULL AND comment_id IS NULL)"
            " OR (source_kind = 'note' AND note_id IS NOT NULL AND comment_id IS NULL)"
            " OR (source_kind = 'comment' AND comment_id IS NOT NULL AND note_id IS NULL)",
            name="ck_document_mentions_source",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    source_document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    source_kind: Mapped[str] = mapped_column(String(20))
    note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_notes.id", ondelete="CASCADE"), index=True
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    target_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    target_tag_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), index=True
    )
    excerpt: Mapped[str] = mapped_column(Text)


class DocumentReadRow(Base):
    """When a member last opened a Document's detail page (spec 19b): the
    Comments created after it, by someone else, are new to them. Deleted with
    the Document, and by the API when the member leaves the Room."""

    __tablename__ = "document_reads"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DocumentVersionRow(Base):
    """A revision of a Document: its name, its description and its Notes
    (spec 24b). `notes` is a list of `{id, title, description, visibility,
    selective_user_ids}` in display order. Deleted with the Document."""

    __tablename__ = "document_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    edited_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DocumentImageRow(Base):
    """An image in a Document's gallery. Only the Storage path is kept here,
    never the bytes."""

    __tablename__ = "document_images"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    # The Comment this image was attached to, if any. CASCADE, not SET NULL:
    # un-linking would silently widen a Private Comment's image to everyone
    # who sees the Document.
    post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    storage_path: Mapped[str] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The image that leads the Document (spec 07). At most one per Document:
    # the partial unique index below is what actually enforces it, so two
    # concurrent "set favorite" requests can't both win.
    is_favorite: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), default=False)

    __table_args__ = (
        Index(
            "uq_document_images_one_favorite",
            "document_id",
            unique=True,
            postgresql_where=text("is_favorite"),
        ),
    )


class DocumentFileRow(Base):
    """A PDF Attachment on a Document (D-21, spec 16). Only the Storage path is
    kept here, never the bytes. Cascades with the Document, but its Storage
    object doesn't: deleting a Document or a Room queues every file for
    removal first (`app/api/document_files.py::remove_files`)."""

    __tablename__ = "document_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    storage_path: Mapped[str] = mapped_column(String(500))
    display_name: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String(100))
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FriendshipRow(Base):
    """A Friendship or a request for one (D-26, spec 18), not tied to any
    Room. One row per pair: the two ids are stored ordered and unique
    together. A declined row is kept for the 30-day cooldown (D-27)."""

    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("user_low", "user_high", name="uq_friendships_pair"),
        CheckConstraint("user_low < user_high", name="ck_friendships_ordered_pair"),
        CheckConstraint(
            "requested_by IN (user_low, user_high)", name="ck_friendships_requested_by_in_pair"
        ),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined')", name="ck_friendships_status"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_low: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    user_high: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_from_sender: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), default=False
    )


class FriendCodeRow(Base):
    """A user's Friend code (D-27, FR-F4): one per user, unique across
    users. Regenerating overwrites it, so the old code stops working."""

    __tablename__ = "friend_codes"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RevealRow(Base):
    """A Reveal (FR-V2, VR-06, spec 22): the Master widened who sees a
    Document, a Note or a Comment in one step. `document_id` is the Document
    the content is or belongs to; `note_id`/`comment_id` say which Note or
    Comment, as `content_kind` says (CHECK). Separate FK columns rather than
    one `content_id`, so the row goes with whatever it revealed (CASCADE),
    like `document_mentions`. Its recipients are in `reveal_recipients`."""

    __tablename__ = "reveals"
    __table_args__ = (
        CheckConstraint(
            "(content_kind = 'document' AND note_id IS NULL AND comment_id IS NULL)"
            " OR (content_kind = 'note' AND note_id IS NOT NULL AND comment_id IS NULL)"
            " OR (content_kind = 'comment' AND comment_id IS NOT NULL AND note_id IS NULL)",
            name="ck_reveals_content",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), index=True
    )
    content_kind: Mapped[str] = mapped_column(String(20))
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_notes.id", ondelete="CASCADE"), index=True
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    revealed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    revealed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RevealRecipientRow(Base):
    """A member who gained access through a Reveal (spec 22 Decision 3), and
    when they first opened it (`seen_at`, NULL until then). Goes with its
    Reveal; deleted by the API when the member leaves the Room."""

    __tablename__ = "reveal_recipients"

    reveal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reveals.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StorageCleanupRow(Base):
    """A Storage object that may no longer be referenced by any
    `document_images`, `document_files` or `users.avatar_path` row and must
    be removed once that's certain - see app/db/storage_cleanup.py. Storage
    isn't part of the Postgres transaction, so this is how a rolled-back or
    half-finished image or file change is reconciled instead of leaving an
    orphan or a broken link."""

    __tablename__ = "storage_cleanup"

    storage_path: Mapped[str] = mapped_column(String(500), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ExportJobRow(Base):
    """A Room PDF being generated or ready to download (spec 23b, 23b_1c).
    `options` is the request (`app/domain/export_jobs.py::PdfOptions`), `status`
    follows `ExportStatus`. `storage_path` is the finished file in the private
    `exports/` prefix, kept for 24 hours (removed through `storage_cleanup`,
    after which the row is `expired` and the path null). At most one queued or
    running job per user and Room (a partial unique index)."""

    __tablename__ = "export_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed', 'expired')",
            name="ck_export_jobs_status",
        ),
        Index(
            "uq_export_jobs_one_active",
            "room_id",
            "requested_by",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), index=True
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    options: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20))
    storage_path: Mapped[str | None] = mapped_column(String(500))
    error: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
