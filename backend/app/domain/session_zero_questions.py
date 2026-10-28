"""The Questions module of Session 0 (spec 47 Decisions 9-11): the Master's
questions and where each answer goes in the Player's Document, the
Players' answers and who reads them, and the Documents built from them.
Pure: the repository stores the rows, the API creates the Documents."""

import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from app.domain.documents import MAX_SUBTITLE_LENGTH
from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.session_zero import ModuleKind

# Decision 9; a question titles its Note, so it fits a Note's title.
MAX_QUESTIONS = 30
MAX_QUESTION_LENGTH = 200
MAX_HINT_LENGTH = 300
MAX_DOCUMENT_QUESTIONS = 5
# Decision 10.
MAX_ANSWER_LENGTH = 2000
# A Document's name (the `documents.name` column).
MAX_NAME_LENGTH = 200


class QuestionTarget(StrEnum):
    """Where a question's answer goes in the Player's Document (Decision 9)."""

    NAME = "name"
    SUBTITLE = "subtitle"
    DESCRIPTION = "description"
    NOTE = "note"
    DOCUMENT = "document"
    NONE = "none"


@dataclass(frozen=True)
class Question:
    """A question of a Questions module, at `position`; `tag_id` is the Tag
    of the Document a `document` question makes."""

    id: uuid.UUID
    module_id: uuid.UUID
    position: int
    body: str
    hint: str | None
    target: QuestionTarget
    tag_id: uuid.UUID | None = None


@dataclass(frozen=True)
class QuestionSpec:
    """A question as the Master sends it: `id` keeps an existing one (and
    its answers), none adds a new one."""

    id: uuid.UUID | None
    body: str
    hint: str | None
    target: QuestionTarget
    tag_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Answer:
    """A Player's answer; `note_private` makes a Note answer's Note
    Private (Q3)."""

    question_id: uuid.UUID
    user_id: uuid.UUID
    body: str
    note_private: bool
    updated_at: datetime


@dataclass(frozen=True)
class AnswerDocument:
    """A Document made from a Player's answers: their main one
    (`question_id` None) or a "New Document" question's."""

    module_id: uuid.UUID
    user_id: uuid.UUID
    question_id: uuid.UUID | None
    document_id: uuid.UUID


@dataclass(frozen=True)
class DraftNote:
    """A Note answer: its question titles it."""

    title: str
    body: str
    private: bool


@dataclass(frozen=True)
class DraftExtra:
    """A "New Document" answer: its first line names the Document, the rest
    describes it."""

    question_id: uuid.UUID
    name: str
    description: str
    tag_id: uuid.UUID | None


@dataclass(frozen=True)
class DocumentDraft:
    """What a Player's answers make (Decision 11)."""

    name: str
    subtitle: str | None
    description: str
    notes: list[DraftNote] = field(default_factory=list)
    extras: list[DraftExtra] = field(default_factory=list)


class InvalidQuestionsError(DomainError):
    """The questions break a rule of Decision 9."""


class InvalidAnswerError(DomainError):
    """An answer is too long, or names no question of the module."""


class NotQuestionsModuleError(DomainError):
    """The module isn't a Questions one."""


class MasterDoesNotAnswerError(DomainError):
    """The Master writes the questions; Players answer (Decision 14)."""


class NameAnswerMissingError(DomainError):
    """No Document without a name: the Name question is unanswered."""


class DocumentExistsError(DomainError):
    """One Document per Player per Questions module (Decision 11)."""


class CreationDisabledError(DomainError):
    """The Room doesn't let Players create Documents (D-13) and the module
    keeps that rule (Q7)."""


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def clean_questions(specs: Sequence[QuestionSpec]) -> list[QuestionSpec]:
    """Decision 9: up to `MAX_QUESTIONS`, each with a text up to
    `MAX_QUESTION_LENGTH` and an optional hint; exactly one Name question
    (once there are any), at most one Subtitle, at most
    `MAX_DOCUMENT_QUESTIONS` "New Document" ones. Tags are only kept on
    those."""
    if len(specs) > MAX_QUESTIONS:
        raise InvalidQuestionsError("errors.sessionZero.tooManyQuestions", max=MAX_QUESTIONS)
    cleaned: list[QuestionSpec] = []
    for spec in specs:
        body = " ".join(spec.body.split())
        hint = _clean_text(spec.hint) or None
        if not body:
            raise InvalidQuestionsError("errors.sessionZero.questionRequired")
        if len(body) > MAX_QUESTION_LENGTH:
            raise InvalidQuestionsError(
                "errors.sessionZero.questionTooLong", max=MAX_QUESTION_LENGTH
            )
        if hint is not None and len(hint) > MAX_HINT_LENGTH:
            raise InvalidQuestionsError("errors.sessionZero.hintTooLong", max=MAX_HINT_LENGTH)
        tag_id = spec.tag_id if spec.target is QuestionTarget.DOCUMENT else None
        cleaned.append(QuestionSpec(spec.id, body, hint, spec.target, tag_id))
    targets = [spec.target for spec in cleaned]
    if cleaned and targets.count(QuestionTarget.NAME) != 1:
        raise InvalidQuestionsError("errors.sessionZero.oneNameQuestion")
    if targets.count(QuestionTarget.SUBTITLE) > 1:
        raise InvalidQuestionsError("errors.sessionZero.oneSubtitleQuestion")
    if targets.count(QuestionTarget.DOCUMENT) > MAX_DOCUMENT_QUESTIONS:
        raise InvalidQuestionsError(
            "errors.sessionZero.tooManyDocumentQuestions", max=MAX_DOCUMENT_QUESTIONS
        )
    ids = [spec.id for spec in cleaned if spec.id is not None]
    if len(ids) != len(set(ids)):
        raise InvalidQuestionsError("errors.sessionZero.questionOrder")
    return cleaned


def clean_answer(question: Question, body: str) -> str:
    """Decision 10: plain text up to `MAX_ANSWER_LENGTH`, trimmed. A Name
    answer is one line that fits a Document's name, a Subtitle one fits a
    subtitle (they are collapsed to one line)."""
    if question.target in (QuestionTarget.NAME, QuestionTarget.SUBTITLE):
        cleaned = " ".join(body.split())
        limit = MAX_NAME_LENGTH if question.target is QuestionTarget.NAME else MAX_SUBTITLE_LENGTH
    else:
        cleaned = body.strip()
        limit = MAX_ANSWER_LENGTH
    if len(cleaned) > limit:
        raise InvalidAnswerError("errors.sessionZero.answerTooLong", max=limit)
    return cleaned


def ensure_questions_module(kind: ModuleKind) -> None:
    """422 for a module that isn't a Questions one."""
    if kind is not ModuleKind.QUESTIONS:
        raise NotQuestionsModuleError("errors.sessionZero.notQuestionsModule")


def ensure_can_answer(role: RoomRole) -> None:
    """Decision 14: Questions are answered by the Players."""
    if role is RoomRole.MASTER:
        raise MasterDoesNotAnswerError("errors.sessionZero.masterDoesNotAnswer")


def can_read_answer(answer: Answer, viewer_id: uuid.UUID, role: RoomRole, revealed: bool) -> bool:
    """Decision 10, Q2: an answer is its author's and the Master's to read,
    every member's once the Master reveals them."""
    return revealed or role is RoomRole.MASTER or answer.user_id == viewer_id


def may_create(
    role: RoomRole, players_can_create_documents: bool, players_bypass_creation_rule: bool
) -> bool:
    """Q7: a Player creates their own Documents where the Room lets them
    (D-13), or anywhere when the module makes the exception (its default).
    The Master's "for everyone" always may."""
    return role is RoomRole.MASTER or players_can_create_documents or players_bypass_creation_rule


def _first_line(text: str) -> tuple[str, str]:
    first, _, rest = text.partition("\n")
    return " ".join(first.split())[:MAX_NAME_LENGTH], rest.strip()


def draft_documents(
    questions: Sequence[Question],
    answers: Mapping[uuid.UUID, Answer],
    existing_extras: Collection[uuid.UUID] = (),
) -> DocumentDraft:
    """Decision 11: the Player's Document from their answers (`answers` by
    question id): the Name answer names it, the Subtitle one subtitles it,
    each Description answer is a section headed by its question, each Note
    answer a Note titled by it (Private when the Player said so), each "New
    Document" answer a Document of its own (not those in
    `existing_extras`, made before). Unanswered questions add nothing."""
    texts = {qid: answer.body for qid, answer in answers.items() if answer.body.strip()}
    name_question = next((q for q in questions if q.target is QuestionTarget.NAME), None)
    if name_question is None or name_question.id not in texts:
        raise NameAnswerMissingError("errors.sessionZero.nameAnswerMissing")
    subtitle = next(
        (texts[q.id] for q in questions if q.target is QuestionTarget.SUBTITLE and q.id in texts),
        None,
    )
    sections = [
        f"## {q.body}\n\n{texts[q.id]}"
        for q in questions
        if q.target is QuestionTarget.DESCRIPTION and q.id in texts
    ]
    notes = [
        DraftNote(q.body, texts[q.id], answers[q.id].note_private)
        for q in questions
        if q.target is QuestionTarget.NOTE and q.id in texts
    ]
    extras: list[DraftExtra] = []
    for q in questions:
        if q.target is not QuestionTarget.DOCUMENT or q.id not in texts:
            continue
        if q.id in existing_extras:
            continue
        name, description = _first_line(texts[q.id])
        extras.append(DraftExtra(q.id, name, description, q.tag_id))
    return DocumentDraft(
        name=texts[name_question.id],
        subtitle=subtitle,
        description="\n\n".join(sections),
        notes=notes,
        extras=extras,
    )
