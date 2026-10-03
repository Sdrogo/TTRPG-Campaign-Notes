"""A handful of repo-level guards that no route can reach through the public
API: each raises `LookupError` only when the row it just tried to update has
vanished between an earlier existence check and this write - a genuine
concurrency race, not something a single request's own logic can trigger.
Tested directly against the repo functions instead."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import comments_repo, documents_repo, notes_repo, rooms_repo, users_repo
from app.db.models import PostRow
from app.domain.documents import plan_new_document
from app.domain.models import (
    Comment,
    Document,
    DocumentVisibility,
    Membership,
    Note,
    RoomRole,
    UserProfile,
)
from app.domain.rooms import plan_new_room


async def test_updating_a_vanished_membership_raises(db_session: AsyncSession) -> None:
    ghost = Membership(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        role=RoomRole.PLAYER,
        is_admin=False,
    )
    with pytest.raises(LookupError):
        await rooms_repo.update_membership(db_session, ghost)


async def test_changing_settings_of_a_vanished_room_raises(db_session: AsyncSession) -> None:
    with pytest.raises(LookupError):
        await rooms_repo.set_players_can_create_documents(db_session, uuid.uuid4(), True)


async def test_updating_a_vanished_document_raises(db_session: AsyncSession) -> None:
    ghost = Document(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        name="Gone",
        description="",
        visibility=DocumentVisibility.ROOM,
        created_by=uuid.uuid4(),
    )
    with pytest.raises(LookupError):
        await documents_repo.update_document(db_session, ghost)


async def test_linking_a_player_to_a_vanished_document_raises(db_session: AsyncSession) -> None:
    with pytest.raises(LookupError):
        await documents_repo.set_played_by(db_session, uuid.uuid4(), uuid.uuid4())


async def test_saving_the_profile_of_a_vanished_user_raises(db_session: AsyncSession) -> None:
    ghost = UserProfile(user_id=uuid.uuid4(), display_name="Gone")
    with pytest.raises(LookupError):
        await users_repo.save_profile(db_session, ghost)


async def test_updating_a_vanished_comment_raises(db_session: AsyncSession) -> None:
    now = datetime.now(UTC)
    ghost = Comment(
        id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        author_id=uuid.uuid4(),
        body="Gone",
        visibility=DocumentVisibility.ROOM,
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(LookupError):
        await comments_repo.update_comment(db_session, ghost)
    with pytest.raises(LookupError):
        await comments_repo.set_pin_and_resolution(db_session, ghost)
    with pytest.raises(LookupError):
        await comments_repo.set_promotion(db_session, ghost)


async def test_comment_lookup_ignores_a_post_of_another_kind(db_session: AsyncSession) -> None:
    """`posts.kind` is only ever "comment" today, but the table is shared
    with Details once those exist (D-18/D-19) - `get_comments_with_ancestors` must not
    treat one of those as a Comment."""
    creator_id = uuid.uuid4()
    room_plan = plan_new_room("Barovia", None, creator_id)
    await rooms_repo.insert_new_room(db_session, room_plan)
    document_plan = plan_new_document(
        room_plan.room.id, "Castle Ravenloft", "", DocumentVisibility.ROOM, creator_id
    )
    await documents_repo.insert_new_document(db_session, document_plan, [], [])

    other_kind = PostRow(
        id=uuid.uuid4(),
        document_id=document_plan.document.id,
        author_id=creator_id,
        kind="detail",
        body="Not a Comment",
        visibility="room",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(other_kind)
    await db_session.flush()

    assert await comments_repo.get_comments_with_ancestors(db_session, [other_kind.id]) == {}


async def test_unknown_comment_ids_are_simply_absent(db_session: AsyncSession) -> None:
    assert await comments_repo.get_comments_with_ancestors(db_session, [uuid.uuid4()]) == {}


async def test_updating_a_vanished_note_raises(db_session: AsyncSession) -> None:
    now = datetime.now(UTC)
    ghost = Note(
        id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        title="Gone",
        description="",
        visibility=DocumentVisibility.ROOM,
        position=0,
        created_by=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(LookupError):
        await notes_repo.update_note(db_session, ghost)
