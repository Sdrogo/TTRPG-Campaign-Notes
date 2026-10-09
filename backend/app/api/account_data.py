"""The caller's personal data (spec 31, GDPR): a download of everything the
app keeps about them (right of access and portability, art. 15 and 20) and
the deletion of their account (right to erasure, art. 17). Like the rest of
`/account`, both act on the caller only."""

import logging
import uuid
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.access import visible_documents
from app.api.errors import http_error, translated_error
from app.api.rooms import purge_room
from app.auth.dependencies import CurrentUserDep
from app.db import (
    account_repo,
    auth_admin,
    documents_repo,
    friends_repo,
    rooms_repo,
    storage,
    storage_cleanup,
    users_repo,
)
from app.db.models import UserRow
from app.db.session import SessionDep
from app.domain.account import (
    DeletionNotConfirmedError,
    SuccessorNeededError,
    ensure_confirmed,
    plan_account_erasure,
)
from app.domain.friends import view_for
from app.domain.models import Document, Friendship, Membership
from app.i18n.dependencies import LocaleDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["account"])

# Bumped when a field changes meaning or goes away, so a reader of an old
# download can tell.
EXPORT_FORMAT_VERSION = 1


class ExportedProfile(BaseModel):
    """The profile as stored, with the email from the sign-in account."""

    user_id: uuid.UUID
    email: str | None
    display_name: str | None
    pronouns: str | None
    bio: str | None
    avatar_url: str | None
    created_at: datetime | None


class ExportedRoom(BaseModel):
    """A Room the user belongs to, and their place in it."""

    room_id: uuid.UUID
    name: str
    game_system: str | None
    role: str
    is_admin: bool


class ExportedDocument(BaseModel):
    """A Document the user created, owns or plays, among those they see."""

    room_id: uuid.UUID
    document_id: uuid.UUID
    name: str
    created_by_you: bool
    owner: bool
    your_character: bool


class ExportedComment(BaseModel):
    """A Comment the user wrote. `document_name` only when they still see the
    Document; the body keeps mentions as stored tokens."""

    room_id: uuid.UUID | None
    document_id: uuid.UUID
    document_name: str | None
    comment_id: uuid.UUID
    parent_id: uuid.UUID | None
    body: str
    visibility: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class ExportedReaction(BaseModel):
    """An emoji the user put on a Comment."""

    document_id: uuid.UUID
    comment_id: uuid.UUID
    emoji: str


class ExportedUpload(BaseModel):
    """An image or PDF Attachment the user added. Metadata only: the files
    themselves stay downloadable from the Document while it exists."""

    kind: str
    document_id: uuid.UUID
    comment_id: uuid.UUID | None
    name: str | None
    size_bytes: int | None
    content_type: str | None
    created_at: datetime


class ExportedFriend(BaseModel):
    """A Friend or a pending request, as the user sees it in the app."""

    user_id: uuid.UUID
    display_name: str | None
    status: str
    since: datetime


class PersonalDataExport(BaseModel):
    """Everything the app keeps about the caller as a person. The Room
    content they see as a whole is in each Room's export (spec 23)."""

    format_version: int
    generated_at: datetime
    profile: ExportedProfile
    rooms: list[ExportedRoom]
    documents: list[ExportedDocument]
    comments: list[ExportedComment]
    reactions: list[ExportedReaction]
    uploads: list[ExportedUpload]
    friends: list[ExportedFriend]
    friend_code: str | None


class DeleteAccountRequest(BaseModel):
    """`confirmation` must be the fixed word `DELETE` (spec 31_1)."""

    confirmation: str


def _other(friendship: Friendship, user_id: uuid.UUID) -> uuid.UUID:
    """The other user of a Friendship row."""
    return friendship.user_high if friendship.user_low == user_id else friendship.user_low


@router.get("/export")
async def export_personal_data(
    current_user: CurrentUserDep, session: SessionDep
) -> PersonalDataExport:
    """Spec 31_2 (GDPR art. 15 and 20): the caller's personal data as JSON -
    profile, Rooms and roles, the Documents they created, own or play, every
    Comment they wrote, their reactions, uploads, Friends and friend code.
    Document names are given only for Documents they still see
    (Invariant 1); their own Comments are always theirs to read (VR-02)."""
    user_id = uuid.UUID(current_user.id)
    profile = await users_repo.get_profile(session, user_id)
    row = await session.get(UserRow, user_id)
    avatar_urls = await storage.signed_urls([profile.avatar_path] if profile.avatar_path else [])

    memberships = await rooms_repo.list_rooms_for_user(session, user_id)
    by_room: dict[uuid.UUID, Membership] = {room.id: m for room, m in memberships}

    created_or_played = await account_repo.list_documents_created_or_played(session, user_id)
    owned_ids = await account_repo.list_owned_document_ids(session, user_id)
    comments = await account_repo.list_comments_by_author(session, user_id)
    reactions = await account_repo.list_reactions_by_user(session, user_id)
    files = await account_repo.list_files_uploaded_by(session, user_id)
    images = await account_repo.list_images_added_by(session, user_id)

    referenced = (
        {row.id for row in created_or_played}
        | owned_ids
        | {comment.document_id for comment in comments}
    )
    documents = await documents_repo.get_documents_by_ids(session, list(referenced))
    room_of = {document.id: document.room_id for document in documents}
    candidates: dict[uuid.UUID, list[Document]] = defaultdict(list)
    for document in documents:
        if document.room_id in by_room:
            candidates[document.room_id].append(document)
    visible = {
        document.id: document
        for room_id, docs in candidates.items()
        for document in await visible_documents(session, docs, by_room[room_id])
    }
    created_by = {row.id: row.created_by for row in created_or_played}
    played_by = {row.id: row.played_by for row in created_or_played}

    friendships = await friends_repo.list_for_user(session, user_id)
    friend_rows = [(f, view) for f in friendships if (view := view_for(f, user_id)) is not None]
    others = {_other(f, user_id) for f, _ in friend_rows}
    friend_profiles = await users_repo.get_profiles(session, others)
    code = await friends_repo.get_code(session, user_id)

    return PersonalDataExport(
        format_version=EXPORT_FORMAT_VERSION,
        generated_at=datetime.now(UTC),
        profile=ExportedProfile(
            user_id=user_id,
            email=profile.email or current_user.email,
            display_name=profile.display_name,
            pronouns=profile.pronouns,
            bio=profile.bio,
            avatar_url=avatar_urls.get(profile.avatar_path) if profile.avatar_path else None,
            created_at=row.created_at if row else None,
        ),
        rooms=[
            ExportedRoom(
                room_id=room.id,
                name=room.name,
                game_system=room.game_system,
                role=membership.role.value,
                is_admin=membership.is_admin,
            )
            for room, membership in sorted(memberships, key=lambda pair: pair[0].name.casefold())
        ],
        documents=[
            ExportedDocument(
                room_id=document.room_id,
                document_id=document.id,
                name=document.name,
                created_by_you=created_by.get(document.id) == user_id,
                owner=document.id in owned_ids,
                your_character=played_by.get(document.id) == user_id,
            )
            for document in visible.values()
            if document.id in owned_ids or document.id in created_by
        ],
        comments=[
            ExportedComment(
                room_id=room_of.get(comment.document_id),
                document_id=comment.document_id,
                document_name=(
                    visible[comment.document_id].name if comment.document_id in visible else None
                ),
                comment_id=comment.id,
                parent_id=comment.parent_id,
                body=comment.body,
                visibility=comment.visibility.value,
                created_at=comment.created_at,
                updated_at=comment.updated_at,
                deleted_at=comment.deleted_at,
            )
            for comment in comments
        ],
        reactions=[
            ExportedReaction(document_id=document_id, comment_id=comment_id, emoji=emoji)
            for document_id, comment_id, emoji in reactions
        ],
        uploads=[
            ExportedUpload(
                kind="image",
                document_id=image.document_id,
                comment_id=image.post_id,
                name=None,
                size_bytes=None,
                content_type=None,
                created_at=image.created_at,
            )
            for image in images
        ]
        + [
            ExportedUpload(
                kind="file",
                document_id=file.document_id,
                comment_id=None,
                name=file.display_name,
                size_bytes=file.size_bytes,
                content_type=file.content_type,
                created_at=file.created_at,
            )
            for file in files
        ],
        friends=[
            ExportedFriend(
                user_id=_other(friendship, user_id),
                display_name=friend_profiles[_other(friendship, user_id)].display_name,
                status=view.value,
                since=friendship.responded_at or friendship.created_at,
            )
            for friendship, view in friend_rows
        ],
        friend_code=code.code if code else None,
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: DeleteAccountRequest, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> None:
    """Spec 31_1 (GDPR art. 17): permanently deletes the caller's account.
    Rooms where they are the only member are deleted with everything in
    them; every other Room is left as a member leaves it (UC-19, audited),
    and what they wrote there stays, shown as an unknown user. Their
    profile, avatar, Friends, reactions, reads and grants are erased, then
    their sign-in account. 422 without the confirmation word; 409 naming
    the Rooms where they are the last Master or Administrator (D-16). 502
    if the sign-in account can't be deleted: the rest is already gone, and
    calling again finishes the job."""
    try:
        ensure_confirmed(body.confirmation)
    except DeletionNotConfirmedError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    user_id = uuid.UUID(current_user.id)
    rooms = sorted(await rooms_repo.list_rooms_for_user(session, user_id), key=lambda p: p[0].id)
    # Locked in a fixed order, so two requests touching the same Rooms can't
    # deadlock, and before the memberships are read (as in `remove_member`).
    for room, _ in rooms:
        await rooms_repo.lock_room(session, room.id)
    memberships = {
        room.id: await rooms_repo.list_memberships(session, room.id) for room, _ in rooms
    }
    try:
        plan = plan_account_erasure(user_id, memberships, {room.id: room.name for room, _ in rooms})
    except SuccessorNeededError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    for room_id in plan.rooms_to_delete:
        await purge_room(session, room_id)
    for departure in plan.departures:
        await rooms_repo.delete_membership(session, departure.room_id, user_id)
        await documents_repo.clear_played_by_in_room(session, departure.room_id, user_id)
        await rooms_repo.insert_audit_log(session, departure)

    profile = await users_repo.get_profile(session, user_id, for_update=True)
    if profile.avatar_path is not None:
        await storage_cleanup.schedule_removal(session, [profile.avatar_path])
    await account_repo.erase_personal_rows(session, user_id)
    # Committed before the sign-in account goes: if Auth fails, the data is
    # gone anyway and the user, still signed in, can simply ask again.
    await session.commit()
    try:
        await auth_admin.delete_auth_user(current_user.id)
    except Exception as exc:
        logger.exception("Could not delete a sign-in account after erasing its data")
        raise http_error(
            status.HTTP_502_BAD_GATEWAY, "errors.account.signInDeletionFailed", locale
        ) from exc
