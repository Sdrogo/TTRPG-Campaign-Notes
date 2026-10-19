"""The reads and writes of a Room duplication (spec 33): the source Room as
the Master sees it, and the copy's rows. Each kind goes in a fixed number of
statements whatever the number of Documents (NFR-04); the caller owns the
transaction, so the copy is committed whole or not at all."""

import uuid
from collections import defaultdict
from datetime import datetime

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.map_transfer_repo import insert_maps, load_room_maps
from app.db.models import (
    DocumentImageRow,
    DocumentMentionRow,
    DocumentOwnerRow,
    DocumentRow,
    DocumentTagRow,
    DocumentVersionRow,
    NoteRow,
    TagCombinationRow,
    TagCombinationTagRow,
    TagRow,
)
from app.db.rooms_repo import get_room, insert_new_room_rows
from app.db.versions_repo import notes_to_json
from app.domain.models import DocumentVisibility, MentionSourceKind, Tag
from app.domain.room_copy import (
    RoomCopyPlan,
    RoomSource,
    SourceCombination,
    SourceDocument,
    SourceImage,
    SourceNote,
)
from app.domain.versions import NoteState


async def load_source(session: AsyncSession, room_id: uuid.UUID) -> RoomSource | None:
    """The Room with its Tags, Tag combinations, Documents (Notes and gallery
    images included, a Comment's images left out) and maps (spec 40), unfiltered: the
    caller is the Master, who sees everything. None when the Room is gone."""
    room = await get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        return None
    tag_rows = (
        await session.scalars(select(TagRow).where(TagRow.room_id == room_id).order_by(TagRow.id))
    ).all()
    combination_rows = (
        await session.scalars(
            select(TagCombinationRow)
            .where(TagCombinationRow.room_id == room_id)
            .order_by(TagCombinationRow.position, TagCombinationRow.id)
        )
    ).all()
    combination_tags: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for link in await session.scalars(
        select(TagCombinationTagRow)
        .join(TagCombinationRow, TagCombinationRow.id == TagCombinationTagRow.combination_id)
        .where(TagCombinationRow.room_id == room_id)
        .order_by(TagCombinationTagRow.tag_id)
    ):
        combination_tags[link.combination_id].append(link.tag_id)

    document_rows = (
        await session.scalars(
            select(DocumentRow).where(DocumentRow.room_id == room_id).order_by(DocumentRow.id)
        )
    ).all()
    document_ids = [row.id for row in document_rows]
    tags_of: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    notes_of: dict[uuid.UUID, list[SourceNote]] = defaultdict(list)
    images_of: dict[uuid.UUID, list[SourceImage]] = defaultdict(list)
    if document_ids:
        for tag_link in await session.scalars(
            select(DocumentTagRow)
            .where(DocumentTagRow.document_id.in_(document_ids))
            .order_by(DocumentTagRow.tag_id)
        ):
            tags_of[tag_link.document_id].append(tag_link.tag_id)
        for note in await session.scalars(
            select(NoteRow)
            .where(NoteRow.document_id.in_(document_ids))
            .order_by(NoteRow.position, NoteRow.id)
        ):
            notes_of[note.document_id].append(
                SourceNote(
                    id=note.id,
                    title=note.title,
                    text=note.description,
                    visibility=DocumentVisibility(note.visibility),
                    position=note.position,
                )
            )
        for image in await session.scalars(
            select(DocumentImageRow)
            .where(DocumentImageRow.document_id.in_(document_ids))
            .where(DocumentImageRow.post_id.is_(None))
            .order_by(
                DocumentImageRow.is_favorite.desc(),
                DocumentImageRow.created_at,
                DocumentImageRow.id,
            )
        ):
            images_of[image.document_id].append(
                SourceImage(
                    storage_path=image.storage_path,
                    is_favorite=image.is_favorite,
                    created_at=image.created_at,
                    id=image.id,
                )
            )
    return RoomSource(
        room=room,
        tags=tuple(
            Tag(
                id=row.id,
                room_id=row.room_id,
                name=row.name,
                category=row.category,
                main_position=row.main_position,
            )
            for row in tag_rows
        ),
        combinations=tuple(
            SourceCombination(row.position, tuple(combination_tags[row.id]))
            for row in combination_rows
        ),
        documents=tuple(
            SourceDocument(
                id=row.id,
                name=row.name,
                subtitle=row.subtitle,
                text=row.description,
                visibility=DocumentVisibility(row.visibility),
                tag_ids=tuple(tags_of[row.id]),
                notes=tuple(notes_of[row.id]),
                images=tuple(images_of[row.id]),
            )
            for row in document_rows
        ),
        maps=await load_room_maps(session, room_id),
    )


async def insert_copy(session: AsyncSession, plan: RoomCopyPlan, now: datetime) -> None:
    """Writes the copy: the Room with its Master, the Tags and combinations,
    then the Documents with their Owner, Tags, Notes, images, first revision
    (Decision 9) and backlinks, then the maps (spec 40). `now` stamps the
    Notes, revisions and links of maps to Documents."""
    owner = plan.membership.user_id
    await insert_new_room_rows(session, plan.room, plan.membership, plan.tags)
    session.add_all(
        TagCombinationRow(id=c.id, room_id=plan.room.id, position=c.position)
        for c in plan.combinations
    )
    await session.flush()
    session.add_all(
        TagCombinationTagRow(combination_id=c.id, tag_id=tag_id)
        for c in plan.combinations
        for tag_id in c.tag_ids
    )
    session.add_all(
        DocumentRow(
            id=d.id,
            room_id=plan.room.id,
            name=d.name,
            subtitle=d.subtitle,
            description=d.text,
            visibility=d.visibility.value,
            created_by=owner,
        )
        for d in plan.documents
    )
    await session.flush()
    session.add_all(DocumentOwnerRow(document_id=d.id, user_id=owner) for d in plan.documents)
    session.add_all(
        DocumentTagRow(document_id=d.id, tag_id=tag_id)
        for d in plan.documents
        for tag_id in d.tag_ids
    )
    session.add_all(
        NoteRow(
            id=n.id,
            document_id=d.id,
            title=n.title,
            description=n.text,
            visibility=n.visibility.value,
            position=n.position,
            created_by=owner,
            created_at=now,
            updated_at=now,
        )
        for d in plan.documents
        for n in d.notes
    )
    session.add_all(
        DocumentImageRow(
            id=i.id,
            document_id=d.id,
            storage_path=i.storage_path,
            created_by=owner,
            created_at=i.created_at,
            is_favorite=i.is_favorite,
        )
        for d in plan.documents
        for i in d.images
    )
    session.add_all(
        DocumentVersionRow(
            id=uuid.uuid4(),
            document_id=d.id,
            name=d.name,
            subtitle=d.subtitle,
            description=d.text,
            notes=notes_to_json(
                tuple(NoteState(n.id, n.title, n.text, n.visibility) for n in d.notes)
            ),
            edited_by=owner,
            created_at=now,
            updated_at=now,
        )
        for d in plan.documents
    )
    await session.flush()
    if plan.backlinks:
        await session.execute(
            insert(DocumentMentionRow),
            [
                {
                    "id": uuid.uuid4(),
                    "source_document_id": b.document_id,
                    "source_kind": (
                        MentionSourceKind.DESCRIPTION
                        if b.note_id is None
                        else MentionSourceKind.NOTE
                    ).value,
                    "note_id": b.note_id,
                    "comment_id": None,
                    "target_document_id": b.mention.target_document_id,
                    "target_tag_id": b.mention.target_tag_id,
                    "excerpt": b.mention.excerpt,
                }
                for b in plan.backlinks
            ],
        )
    await insert_maps(session, plan.maps, owner, now)
