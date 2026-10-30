"""The Poll module of Session 0 (spec 53): the Master writes the polls and
their settings, closes and reveals them; the Players (and the Master, on a
poll that says so) vote. Every write answers with the open round's boards,
like the rest of Session 0 (`app/api/session_zero.py`)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import http_error
from app.api.session_zero import (
    SessionZeroResponse,
    _answer,
    _begin_write,
    _domain_error,
    _open_module,
    _shared,
    _Write,
)
from app.api.session_zero import (
    router as _session_zero_router,
)
from app.auth.dependencies import CurrentUserDep
from app.db import session_zero_polls_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.session_zero import Module, ensure_master, ensure_round_open
from app.domain.session_zero_polls import (
    OptionSpec,
    Poll,
    PollResults,
    PollSpec,
    VotersVisible,
    clean_polls,
    clean_vote,
    ensure_can_vote,
    ensure_poll_module,
    ensure_settings_kept,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix=_session_zero_router.prefix, tags=["session-zero"])


class OptionBody(BaseModel):
    """A choice; `id` keeps an existing one with its votes."""

    id: uuid.UUID | None = None
    body: str


class PollBody(BaseModel):
    """A poll and its settings (Decision 2); `id` keeps an existing one."""

    id: uuid.UUID | None = None
    body: str
    hint: str | None = None
    max_choices: int = 1
    master_votes: bool = False
    voters_visible: VotersVisible = VotersVisible.MASTER
    results: PollResults = PollResults.LIVE
    options: list[OptionBody]


class PollsBody(BaseModel):
    """A module's whole list of polls, in order (Decision 3)."""

    polls: list[PollBody]


class VoteBody(BaseModel):
    """The caller's whole vote on a poll; empty withdraws it."""

    option_ids: list[uuid.UUID] = Field(default_factory=list)


class ClosedBody(BaseModel):
    """Whether the poll takes no more votes (Decision 6)."""

    closed: bool


class RevealBody(BaseModel):
    """Whether a secret poll's tally is shown to everyone (Decision 5)."""

    revealed: bool


def _poll_module(write: _Write, module_id: uuid.UUID, locale: str) -> Module:
    """A Poll module of the open round the caller has reached (404
    otherwise, 409 for a closed round's, 422 for another kind)."""
    module = _open_module(write, module_id, locale)
    ensure_poll_module(module.kind)
    return module


async def _poll_or_404(
    session: AsyncSession, write: _Write, poll_id: uuid.UUID, locale: str
) -> Poll:
    """A poll of a module the caller has reached, in the open round (409
    for a closed round's)."""
    poll = await session_zero_polls_repo.get_poll(session, poll_id)
    module = next((m for m in write.board.modules if poll and m.id == poll.module_id), None)
    if poll is None or module is None or module.id in write.hidden:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.pollNotFound", locale)
    try:
        ensure_round_open(next(r for r in write.board.rounds if r.id == module.round_id))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    return poll


@router.put("/modules/{module_id}/polls")
async def set_polls(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    body: PollsBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decisions 2 and 3: the Master stores a Poll module's whole list of
    polls. Polls and choices sent with their `id` keep their votes; those
    left out go with theirs. 422 for an `id` that isn't the module's (or
    its poll's), 409 for settings changed on a poll that has votes."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _poll_module(write, module_id, locale)
        specs = clean_polls(
            [
                PollSpec(
                    id=p.id,
                    body=p.body,
                    hint=p.hint,
                    max_choices=p.max_choices,
                    master_votes=p.master_votes,
                    voters_visible=p.voters_visible,
                    results=p.results,
                    options=tuple(OptionSpec(o.id, o.body) for o in p.options),
                )
                for p in body.polls
            ]
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    polls = {p.id: p for p in await session_zero_polls_repo.list_polls(session, [module.id])}
    options = await session_zero_polls_repo.list_options(session, list(polls))
    voted = {v.poll_id for v in await session_zero_polls_repo.list_votes(session, list(polls))}
    for spec in specs:
        if spec.id is None:
            if any(option.id is not None for option in spec.options):
                raise http_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.pollOrder", locale
                )
            continue
        poll = polls.get(spec.id)
        own = {o.id for o in options if o.poll_id == spec.id}
        if poll is None or any(o.id is not None and o.id not in own for o in spec.options):
            raise http_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.pollOrder", locale
            )
        try:
            ensure_settings_kept(spec, poll, spec.id in voted)
        except DomainError as exc:
            raise _domain_error(exc, locale) from exc
    await session_zero_polls_repo.replace_polls(
        session, room_id, module.id, specs, datetime.now(UTC)
    )
    await _shared(session, room_id, "module", module.id)
    return await _answer(session, room_id, write, locale)


@router.put("/polls/{poll_id}/vote")
async def vote(
    room_id: uuid.UUID,
    poll_id: uuid.UUID,
    body: VoteBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 4: a voter's whole vote on a poll, replacing their previous
    one; none withdraws it. Everyone hears of it, since the number of
    voters is public (Decision 8)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    poll = await _poll_or_404(session, write, poll_id, locale)
    try:
        ensure_can_vote(poll, write.viewer.role)
        own = {o.id for o in await session_zero_polls_repo.list_options(session, [poll.id])}
        chosen = clean_vote(poll, body.option_ids, own)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if await session_zero_polls_repo.set_vote(
        session, room_id, poll.id, write.viewer.user_id, chosen, datetime.now(UTC)
    ):
        await _shared(session, room_id, "vote", poll.id)
    return await _answer(session, room_id, write, locale)


@router.put("/polls/{poll_id}/closed")
async def close_poll(
    room_id: uuid.UUID,
    poll_id: uuid.UUID,
    body: ClosedBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 6: the Master closes a poll (no more votes) or reopens it."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    poll = await _poll_or_404(session, write, poll_id, locale)
    if body.closed != poll.closed:
        await session_zero_polls_repo.set_poll_state(
            session, poll.id, closed_at=datetime.now(UTC) if body.closed else None
        )
        await _shared(session, room_id, "module", poll.module_id)
    return await _answer(session, room_id, write, locale)


@router.put("/polls/{poll_id}/reveal")
async def reveal_poll(
    room_id: uuid.UUID,
    poll_id: uuid.UUID,
    body: RevealBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 5: the Master shows a secret poll's tally to everyone who
    reached it, or hides it again."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    poll = await _poll_or_404(session, write, poll_id, locale)
    if body.revealed != poll.revealed:
        await session_zero_polls_repo.set_poll_state(session, poll.id, revealed=body.revealed)
        await _shared(session, room_id, "module", poll.module_id)
    return await _answer(session, room_id, write, locale)
