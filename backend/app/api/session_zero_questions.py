"""The Questions module of Session 0 (spec 47 Decisions 9-11): the Master
writes the questions and maps each to where its answer goes, the Players
answer (seen by them and the Master until the Master reveals them all),
and their answers become Documents they own. Every write answers with the
open round's boards, like the rest of Session 0 (`app/api/session_zero.py`)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import http_error, translated_error
from app.api.session_zero import (
    SessionZeroResponse,
    _answer,
    _begin_write,
    _domain_error,
    _open_module,
    _push,
    _shared,
    _Write,
)
from app.api.session_zero import (
    router as _session_zero_router,
)
from app.api.versions import record_revision
from app.auth.dependencies import CurrentUserDep
from app.db import (
    documents_repo,
    notes_repo,
    rooms_repo,
    session_zero_questions_repo,
    session_zero_repo,
    tags_repo,
)
from app.db.session import SessionDep
from app.domain.characters import plan_player_change
from app.domain.documents import (
    DocumentNameRequiredError,
    DocumentSubtitleTooLongError,
    plan_new_document,
)
from app.domain.errors import DomainError
from app.domain.models import DocumentVisibility, Note, RoomRole
from app.domain.notes import plan_new_note
from app.domain.session_zero import Module, ensure_master
from app.domain.session_zero_questions import (
    Answer,
    AnswerDocument,
    CreationDisabledError,
    DocumentExistsError,
    InvalidAnswerError,
    Question,
    QuestionSpec,
    QuestionTarget,
    clean_answer,
    clean_questions,
    draft_documents,
    ensure_can_answer,
    ensure_questions_module,
    may_create,
)
from app.i18n.dependencies import LocaleDep
from app.realtime.broker import Event

router = APIRouter(prefix=_session_zero_router.prefix, tags=["session-zero"])


class ModuleSettingsBody(BaseModel):
    """A Questions module's settings; only those sent change. `tag_id` null
    gives its Documents no Tag."""

    tag_id: uuid.UUID | None = None
    players_bypass_creation_rule: bool | None = None


class QuestionBody(BaseModel):
    """A question; `id` keeps an existing one with its answers."""

    id: uuid.UUID | None = None
    body: str
    hint: str | None = None
    target: QuestionTarget
    tag_id: uuid.UUID | None = None


class QuestionsBody(BaseModel):
    """A module's whole list of questions, in order (Decision 9)."""

    questions: list[QuestionBody]


class AnswerBody(BaseModel):
    """The caller's answer to one question; empty deletes it."""

    question_id: uuid.UUID
    body: str
    note_private: bool = False


class AnswersBody(BaseModel):
    """Some of the caller's answers, saved as they type (Decision 10)."""

    answers: list[AnswerBody]


class RevealBody(BaseModel):
    """Whether every member who reached the module reads the answers (Q2)."""

    revealed: bool


def _questions_module(write: _Write, module_id: uuid.UUID, locale: str) -> Module:
    """A Questions module of the open round the caller has reached (404
    otherwise, 409 for a closed round's, 422 for another kind)."""
    module = _open_module(write, module_id, locale)
    ensure_questions_module(module.kind)
    return module


async def _ensure_room_tag(
    session: AsyncSession, room_id: uuid.UUID, tag_ids: set[uuid.UUID], locale: str
) -> None:
    """422 unless every Tag is one of this Room's."""
    if len(await tags_repo.get_tags_by_ids(session, room_id, list(tag_ids))) != len(tag_ids):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.document.invalidTagIds", locale
        )


async def _answers_changed(
    session: AsyncSession, write: _Write, module: Module, user_id: uuid.UUID
) -> None:
    """Revealed answers are every member's news; until then only the
    author's and the Masters' streams hear of them, at the unchanged
    revision (Decision 12)."""
    room_id = write.viewer.room_id
    if module.answers_revealed:
        await _shared(session, room_id, "answer", module.id)
        return
    masters = [
        m.user_id
        for m in await rooms_repo.list_memberships(session, room_id)
        if m.role is RoomRole.MASTER
    ]
    for reader in {user_id, *masters}:
        _push(session, room_id, Event(write.revision, "answer", module.id), user_id=reader)


@router.patch("/modules/{module_id}")
async def update_module(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    body: ModuleSettingsBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decisions 9 and 11: the Master sets a Questions module's Tag
    and whether its Players create their Documents even where the Room
    doesn't let them (Q7)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _questions_module(write, module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    values: dict[str, object] = {}
    if "tag_id" in body.model_fields_set:
        if body.tag_id is not None:
            await _ensure_room_tag(session, room_id, {body.tag_id}, locale)
        values["tag_id"] = body.tag_id
    if body.players_bypass_creation_rule is not None:
        values["players_bypass_creation_rule"] = body.players_bypass_creation_rule
    if values:
        await session_zero_repo.set_module_settings(session, module.id, **values)
        await _shared(session, room_id, "module", module.id)
    return await _answer(session, room_id, write, locale)


@router.put("/modules/{module_id}/questions")
async def set_questions(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    body: QuestionsBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 9: the Master stores a Questions module's whole list
    of questions. Questions sent with their `id` keep their answers; those
    left out go with theirs. 422 for an `id` that isn't one of the module's,
    or a list breaking the rules (one Name question, ...)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _questions_module(write, module_id, locale)
        specs = clean_questions(
            [QuestionSpec(q.id, q.body, q.hint, q.target, q.tag_id) for q in body.questions]
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    existing = {
        q.id for q in await session_zero_questions_repo.list_questions(session, [module.id])
    }
    if any(spec.id is not None and spec.id not in existing for spec in specs):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.questionOrder", locale
        )
    tag_ids = {spec.tag_id for spec in specs if spec.tag_id is not None}
    if tag_ids:
        await _ensure_room_tag(session, room_id, tag_ids, locale)
    await session_zero_questions_repo.replace_questions(
        session, room_id, module.id, specs, datetime.now(UTC)
    )
    await _shared(session, room_id, "module", module.id)
    return await _answer(session, room_id, write, locale)


@router.put("/modules/{module_id}/answers")
async def save_answers(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    body: AnswersBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 10: a Player saves some of their answers as they
    type (an empty one is deleted). The Master doesn't answer (403)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_can_answer(write.viewer.role)
        module = _questions_module(write, module_id, locale)
        questions = {
            q.id: q for q in await session_zero_questions_repo.list_questions(session, [module.id])
        }
        cleaned: list[tuple[Question, str, bool]] = []
        for answer in body.answers:
            question = questions.get(answer.question_id)
            if question is None:
                raise InvalidAnswerError("errors.sessionZero.questionNotFound")
            cleaned.append((question, clean_answer(question, answer.body), answer.note_private))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    now = datetime.now(UTC)
    for question, text, private in cleaned:
        await session_zero_questions_repo.save_answer(
            session,
            room_id,
            question.id,
            write.viewer.user_id,
            text,
            private and question.target is QuestionTarget.NOTE,
            now,
        )
    if cleaned:
        await _answers_changed(session, write, module, write.viewer.user_id)
    return await _answer(session, room_id, write, locale)


@router.put("/modules/{module_id}/reveal")
async def reveal_answers(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    body: RevealBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 10, Q2: the Master shows every member who reached
    the module everyone's answers, read-only, or hides them again. The
    Documents already made don't change."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _questions_module(write, module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if module.answers_revealed != body.revealed:
        await session_zero_repo.set_module_settings(
            session, module.id, answers_revealed=body.revealed
        )
        await _shared(session, room_id, "answer", module.id)
    return await _answer(session, room_id, write, locale)


async def _create_documents(
    session: AsyncSession,
    write: _Write,
    module: Module,
    questions: list[Question],
    answers: list[Answer],
    links: list[AnswerDocument],
    player_id: uuid.UUID,
    locale: str,
) -> None:
    """Decision 11: the Player's Document from their answers (Public, the
    module's Tag, the Player its Owner and Character player, Notes Public
    or Private), and a Document for each "New Document" answer not made
    yet (Public, its question's Tag, the Player its Owner)."""
    room_id = write.viewer.room_id
    actor_id = write.viewer.user_id
    if any(link.user_id == player_id and link.question_id is None for link in links):
        raise DocumentExistsError("errors.sessionZero.documentExists")
    mine = {a.question_id: a for a in answers if a.user_id == player_id}
    made = {link.question_id for link in links if link.user_id == player_id and link.question_id}
    draft = draft_documents(questions, mine, made)
    now = datetime.now(UTC)
    try:
        plan = plan_new_document(
            room_id,
            draft.name,
            draft.description,
            DocumentVisibility.ROOM,
            player_id,
            draft.subtitle,
        )
    except (DocumentNameRequiredError, DocumentSubtitleTooLongError) as exc:  # pragma: no cover
        # The answers were cleaned to fit (`clean_answer`).
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    tags = [module.tag_id] if module.tag_id else []
    await documents_repo.insert_new_document(session, plan, tags, [])
    character = plan_player_change(
        plan.document, actor_id, [player_id], [player_id], player_id, False
    )
    await documents_repo.set_played_by(session, plan.document.id, player_id)
    for entry in character.audit_entries:
        await rooms_repo.insert_audit_log(session, entry)
    notes: list[Note] = []
    for draft_note in draft.notes:
        note = plan_new_note(
            plan.document.id,
            player_id,
            draft_note.title,
            draft_note.body,
            DocumentVisibility.PRIVATE if draft_note.private else DocumentVisibility.ROOM,
            notes,
            now,
        )
        await notes_repo.insert_note(session, note, [])
        notes.append(note)
    await record_revision(session, plan.document.id, actor_id, now=now)
    await session_zero_questions_repo.add_answer_document(
        session, room_id, AnswerDocument(module.id, player_id, None, plan.document.id), now
    )
    for extra in draft.extras:
        extra_plan = plan_new_document(
            room_id, extra.name, extra.description, DocumentVisibility.ROOM, player_id
        )
        await documents_repo.insert_new_document(
            session, extra_plan, [extra.tag_id] if extra.tag_id else [], []
        )
        await record_revision(session, extra_plan.document.id, actor_id, now=now)
        await session_zero_questions_repo.add_answer_document(
            session,
            room_id,
            AnswerDocument(module.id, player_id, extra.question_id, extra_plan.document.id),
            now,
        )


async def _module_answers(
    session: AsyncSession, module: Module
) -> tuple[list[Question], list[Answer], list[AnswerDocument]]:
    questions = await session_zero_questions_repo.list_questions(session, [module.id])
    answers = await session_zero_questions_repo.list_answers(session, [q.id for q in questions])
    links = await session_zero_questions_repo.list_answer_documents(session, [module.id])
    return questions, answers, links


@router.post("/modules/{module_id}/documents")
async def create_my_document(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 11: a Player who answered the Name question makes
    their Document (409 when they have one, or no Name answer). Where the
    Room doesn't let Players create Documents (D-13), only a module that
    makes the exception lets them (403 otherwise, Q7)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    try:
        ensure_can_answer(write.viewer.role)
        module = _questions_module(write, module_id, locale)
        if not may_create(
            write.viewer.role,
            room.players_can_create_documents,
            module.players_bypass_creation_rule,
        ):
            raise CreationDisabledError("errors.document.creationDisabled")
        questions, answers, links = await _module_answers(session, module)
        await _create_documents(
            session, write, module, questions, answers, links, write.viewer.user_id, locale
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await _shared(session, room_id, "document", module.id)
    return await _answer(session, room_id, write, locale)


@router.post("/modules/{module_id}/documents/all")
async def create_everyone_documents(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 11: the Master makes the Document of every Player
    who answered the Name question and has none yet, whatever the Room's
    D-13 setting; nobody to make it for changes nothing."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _questions_module(write, module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    questions, answers, links = await _module_answers(session, module)
    name_id = next((q.id for q in questions if q.target is QuestionTarget.NAME), None)
    with_document = {link.user_id for link in links if link.question_id is None}
    players = [
        m.user_id
        for m in await rooms_repo.list_memberships(session, room_id)
        if m.role is RoomRole.PLAYER
    ]
    named = {a.user_id for a in answers if a.question_id == name_id}
    todo = [p for p in players if p in named and p not in with_document]
    for player_id in todo:
        await _create_documents(
            session, write, module, questions, answers, links, player_id, locale
        )
    if todo:
        await _shared(session, room_id, "document", module.id)
    return await _answer(session, room_id, write, locale)
