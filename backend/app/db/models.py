"""SQLAlchemy table definitions. Alembic migrations (backend/migrations) are
generated from these; the repositories map rows to the domain dataclasses in
app/domain/models.py."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base of every table, and the metadata Alembic compares
    against."""


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
    __table_args__ = (UniqueConstraint("room_id", "name", name="uq_tag_room_name"),)

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
    `details`."""

    __tablename__ = "audit_log"

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


class PostVisibilityGrantRow(Base):
    """A user who may see a Selective Post besides its author and the
    Master."""

    __tablename__ = "post_visibility_grants"

    post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)


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
