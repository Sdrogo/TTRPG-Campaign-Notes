"""The Questions module of Session 0 (spec 47_2): rows to and from the
dataclasses in `app/domain/session_zero_questions.py`. Reads return rows
unfiltered; the API keeps answers to their readers (Decision 10)."""

import uuid
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    SessionZeroAnswerDocumentRow,
    SessionZeroAnswerRow,
    SessionZeroQuestionRow,
)
from app.domain.session_zero_questions import (
    Answer,
    AnswerDocument,
    Question,
    QuestionSpec,
    QuestionTarget,
)


def _question(row: SessionZeroQuestionRow) -> Question:
    return Question(
        id=row.id,
        module_id=row.module_id,
        position=row.position,
        body=row.body,
        hint=row.hint,
        target=QuestionTarget(row.target),
        tag_id=row.tag_id,
    )


def _answer(row: SessionZeroAnswerRow) -> Answer:
    return Answer(
        question_id=row.question_id,
        user_id=row.user_id,
        body=row.body,
        note_private=row.note_private,
        updated_at=row.updated_at,
    )


async def list_questions(
    session: AsyncSession, module_ids: Collection[uuid.UUID]
) -> list[Question]:
    """The questions of these modules, each module's in order."""
    if not module_ids:
        return []
    result = await session.execute(
        select(SessionZeroQuestionRow)
        .where(SessionZeroQuestionRow.module_id.in_(module_ids))
        .order_by(SessionZeroQuestionRow.position)
    )
    return [_question(row) for row in result.scalars()]


async def replace_questions(
    session: AsyncSession,
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    specs: Sequence[QuestionSpec],
    now: datetime,
) -> None:
    """Stores a module's whole list of questions, in order: those with an
    `id` are updated (keeping their answers), the others added, the ones
    left out deleted with their answers. The caller checked every `id` is
    one of the module's."""
    kept = {spec.id for spec in specs if spec.id is not None}
    await session.execute(
        delete(SessionZeroQuestionRow).where(
            SessionZeroQuestionRow.module_id == module_id, SessionZeroQuestionRow.id.not_in(kept)
        )
    )
    for position, spec in enumerate(specs):
        values = {
            "position": position,
            "body": spec.body,
            "hint": spec.hint,
            "target": spec.target.value,
            "tag_id": spec.tag_id,
        }
        if spec.id is None:
            session.add(
                SessionZeroQuestionRow(
                    id=uuid.uuid4(), room_id=room_id, module_id=module_id, created_at=now, **values
                )
            )
        else:
            await session.execute(
                update(SessionZeroQuestionRow)
                .where(SessionZeroQuestionRow.id == spec.id)
                .values(**values)
            )
    await session.flush()


async def copy_questions(
    session: AsyncSession,
    room_id: uuid.UUID,
    source_module_id: uuid.UUID,
    module_id: uuid.UUID,
    now: datetime,
) -> None:
    """A new session's Questions module takes the previous one's questions,
    not its answers (spec 47 Decision 2)."""
    for question in await list_questions(session, [source_module_id]):
        session.add(
            SessionZeroQuestionRow(
                id=uuid.uuid4(),
                room_id=room_id,
                module_id=module_id,
                position=question.position,
                body=question.body,
                hint=question.hint,
                target=question.target.value,
                tag_id=question.tag_id,
                created_at=now,
            )
        )
    await session.flush()


async def list_answers(session: AsyncSession, question_ids: Collection[uuid.UUID]) -> list[Answer]:
    """Every answer to these questions, whoever wrote it."""
    if not question_ids:
        return []
    result = await session.execute(
        select(SessionZeroAnswerRow).where(SessionZeroAnswerRow.question_id.in_(question_ids))
    )
    return [_answer(row) for row in result.scalars()]


async def save_answer(
    session: AsyncSession,
    room_id: uuid.UUID,
    question_id: uuid.UUID,
    user_id: uuid.UUID,
    body: str,
    note_private: bool,
    now: datetime,
) -> None:
    """Stores a Player's answer, or deletes it when `body` is empty."""
    if not body:
        await session.execute(
            delete(SessionZeroAnswerRow).where(
                SessionZeroAnswerRow.question_id == question_id,
                SessionZeroAnswerRow.user_id == user_id,
            )
        )
        return
    values = {"body": body, "note_private": note_private, "updated_at": now}
    await session.execute(
        insert(SessionZeroAnswerRow)
        .values(question_id=question_id, user_id=user_id, room_id=room_id, **values)
        .on_conflict_do_update(
            index_elements=[SessionZeroAnswerRow.question_id, SessionZeroAnswerRow.user_id],
            set_=values,
        )
    )


async def list_answer_documents(
    session: AsyncSession, module_ids: Collection[uuid.UUID]
) -> list[AnswerDocument]:
    """The Documents made from these modules' answers."""
    if not module_ids:
        return []
    result = await session.execute(
        select(SessionZeroAnswerDocumentRow).where(
            SessionZeroAnswerDocumentRow.module_id.in_(module_ids)
        )
    )
    return [
        AnswerDocument(
            module_id=row.module_id,
            user_id=row.user_id,
            question_id=row.question_id,
            document_id=row.document_id,
        )
        for row in result.scalars()
    ]


async def add_answer_document(
    session: AsyncSession, room_id: uuid.UUID, link: AnswerDocument, now: datetime
) -> None:
    """Records which Document a Player's answers made (Decision 11)."""
    session.add(
        SessionZeroAnswerDocumentRow(
            id=uuid.uuid4(),
            room_id=room_id,
            module_id=link.module_id,
            user_id=link.user_id,
            question_id=link.question_id,
            document_id=link.document_id,
            created_at=now,
        )
    )
    await session.flush()


async def list_answers_by_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[uuid.UUID, str, Answer]]:
    """Every Session 0 answer the user wrote, in every Room, with its Room
    and question (spec 31 export), oldest first."""
    result = await session.execute(
        select(SessionZeroAnswerRow, SessionZeroQuestionRow.body)
        .join(
            SessionZeroQuestionRow,
            SessionZeroQuestionRow.id == SessionZeroAnswerRow.question_id,
        )
        .where(SessionZeroAnswerRow.user_id == user_id)
        .order_by(SessionZeroAnswerRow.updated_at)
    )
    return [(row.room_id, question, _answer(row)) for row, question in result.all()]
