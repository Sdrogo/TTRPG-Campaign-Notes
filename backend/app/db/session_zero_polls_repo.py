"""The Poll module of Session 0 (spec 53): rows to and from the dataclasses
in `app/domain/session_zero_polls.py`. Reads return rows unfiltered; the
API keeps tallies and names to their readers (Decisions 2 and 5)."""

import uuid
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SessionZeroPollOptionRow, SessionZeroPollRow, SessionZeroPollVoteRow
from app.domain.session_zero_polls import (
    OptionSpec,
    Poll,
    PollOption,
    PollResults,
    PollSpec,
    Vote,
    VotersVisible,
)


def _poll(row: SessionZeroPollRow) -> Poll:
    return Poll(
        id=row.id,
        module_id=row.module_id,
        position=row.position,
        body=row.body,
        hint=row.hint,
        max_choices=row.max_choices,
        master_votes=row.master_votes,
        voters_visible=VotersVisible(row.voters_visible),
        results=PollResults(row.results),
        revealed=row.revealed,
        closed_at=row.closed_at,
    )


def _option(row: SessionZeroPollOptionRow) -> PollOption:
    return PollOption(id=row.id, poll_id=row.poll_id, position=row.position, body=row.body)


def _vote(row: SessionZeroPollVoteRow) -> Vote:
    return Vote(
        poll_id=row.poll_id, option_id=row.option_id, user_id=row.user_id, created_at=row.created_at
    )


async def list_polls(session: AsyncSession, module_ids: Collection[uuid.UUID]) -> list[Poll]:
    """The polls of these modules, each module's in order."""
    if not module_ids:
        return []
    result = await session.execute(
        select(SessionZeroPollRow)
        .where(SessionZeroPollRow.module_id.in_(module_ids))
        .order_by(SessionZeroPollRow.position)
    )
    return [_poll(row) for row in result.scalars()]


async def get_poll(session: AsyncSession, poll_id: uuid.UUID) -> Poll | None:
    """One poll, or None."""
    row = await session.get(SessionZeroPollRow, poll_id)
    return _poll(row) if row else None


async def list_options(session: AsyncSession, poll_ids: Collection[uuid.UUID]) -> list[PollOption]:
    """The choices of these polls, each poll's in order."""
    if not poll_ids:
        return []
    result = await session.execute(
        select(SessionZeroPollOptionRow)
        .where(SessionZeroPollOptionRow.poll_id.in_(poll_ids))
        .order_by(SessionZeroPollOptionRow.position)
    )
    return [_option(row) for row in result.scalars()]


async def list_votes(session: AsyncSession, poll_ids: Collection[uuid.UUID]) -> list[Vote]:
    """Every vote on these polls, whoever cast it, oldest first."""
    if not poll_ids:
        return []
    result = await session.execute(
        select(SessionZeroPollVoteRow)
        .where(SessionZeroPollVoteRow.poll_id.in_(poll_ids))
        .order_by(SessionZeroPollVoteRow.created_at)
    )
    return [_vote(row) for row in result.scalars()]


def _poll_values(spec: PollSpec, position: int) -> dict[str, object]:
    return {
        "position": position,
        "body": spec.body,
        "hint": spec.hint,
        "max_choices": spec.max_choices,
        "master_votes": spec.master_votes,
        "voters_visible": spec.voters_visible.value,
        "results": spec.results.value,
    }


async def _add_poll(
    session: AsyncSession,
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    spec: PollSpec,
    position: int,
    now: datetime,
) -> uuid.UUID:
    poll_id = uuid.uuid4()
    session.add(
        SessionZeroPollRow(
            id=poll_id,
            room_id=room_id,
            module_id=module_id,
            created_at=now,
            revealed=False,
            closed_at=None,
            **_poll_values(spec, position),
        )
    )
    await session.flush()
    for index, option in enumerate(spec.options):
        session.add(
            SessionZeroPollOptionRow(
                id=uuid.uuid4(), poll_id=poll_id, position=index, body=option.body
            )
        )
    await session.flush()
    return poll_id


async def replace_polls(
    session: AsyncSession,
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    specs: Sequence[PollSpec],
    now: datetime,
) -> None:
    """Stores a module's whole list of polls, in order: those with an `id`
    are updated (keeping their votes, and those of the choices sent with
    theirs), the others added, the ones left out deleted with their votes.
    The caller checked every `id` is one of the module's, or its poll's."""
    kept = {spec.id for spec in specs if spec.id is not None}
    await session.execute(
        delete(SessionZeroPollRow).where(
            SessionZeroPollRow.module_id == module_id, SessionZeroPollRow.id.not_in(kept)
        )
    )
    for position, spec in enumerate(specs):
        if spec.id is None:
            await _add_poll(session, room_id, module_id, spec, position, now)
            continue
        await session.execute(
            update(SessionZeroPollRow)
            .where(SessionZeroPollRow.id == spec.id)
            .values(**_poll_values(spec, position))
        )
        options = {option.id for option in spec.options if option.id is not None}
        await session.execute(
            delete(SessionZeroPollOptionRow).where(
                SessionZeroPollOptionRow.poll_id == spec.id,
                SessionZeroPollOptionRow.id.not_in(options),
            )
        )
        for index, option in enumerate(spec.options):
            if option.id is None:
                session.add(
                    SessionZeroPollOptionRow(
                        id=uuid.uuid4(), poll_id=spec.id, position=index, body=option.body
                    )
                )
            else:
                await session.execute(
                    update(SessionZeroPollOptionRow)
                    .where(SessionZeroPollOptionRow.id == option.id)
                    .values(position=index, body=option.body)
                )
    await session.flush()


async def copy_polls(
    session: AsyncSession,
    room_id: uuid.UUID,
    source_module_id: uuid.UUID,
    module_id: uuid.UUID,
    now: datetime,
) -> None:
    """A Poll module carried over takes the source's polls, choices and
    settings, not their votes, closed or revealed state (Decision 7)."""
    polls = await list_polls(session, [source_module_id])
    options = await list_options(session, [poll.id for poll in polls])
    for poll in polls:
        spec = PollSpec(
            id=None,
            body=poll.body,
            hint=poll.hint,
            max_choices=poll.max_choices,
            master_votes=poll.master_votes,
            voters_visible=poll.voters_visible,
            results=poll.results,
            options=tuple(
                OptionSpec(None, option.body) for option in options if option.poll_id == poll.id
            ),
        )
        await _add_poll(session, room_id, module_id, spec, poll.position, now)


async def set_vote(
    session: AsyncSession,
    room_id: uuid.UUID,
    poll_id: uuid.UUID,
    user_id: uuid.UUID,
    option_ids: Sequence[uuid.UUID],
    now: datetime,
) -> bool:
    """Replaces the member's vote on the poll as a whole (Decision 4); none
    withdraws it. Whether anything changed."""
    result = await session.execute(
        select(SessionZeroPollVoteRow.option_id).where(
            SessionZeroPollVoteRow.poll_id == poll_id, SessionZeroPollVoteRow.user_id == user_id
        )
    )
    before = set(result.scalars())
    if before == set(option_ids):
        return False
    await session.execute(
        delete(SessionZeroPollVoteRow).where(
            SessionZeroPollVoteRow.poll_id == poll_id, SessionZeroPollVoteRow.user_id == user_id
        )
    )
    for option_id in option_ids:
        session.add(
            SessionZeroPollVoteRow(
                option_id=option_id,
                user_id=user_id,
                poll_id=poll_id,
                room_id=room_id,
                created_at=now,
            )
        )
    await session.flush()
    return True


async def set_poll_state(
    session: AsyncSession,
    poll_id: uuid.UUID,
    *,
    closed_at: datetime | None | bool = False,
    revealed: bool | None = None,
) -> None:
    """Closes or reopens (`closed_at`, None reopens; left as `False` it
    stays), reveals or hides a poll."""
    values: dict[str, object] = {}
    if closed_at is not False:
        values["closed_at"] = closed_at
    if revealed is not None:
        values["revealed"] = revealed
    await session.execute(
        update(SessionZeroPollRow).where(SessionZeroPollRow.id == poll_id).values(**values)
    )


async def list_votes_by_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[uuid.UUID, str, str, datetime]]:
    """Every choice the user voted for, in every Room: its Room, the poll's
    question, the choice (spec 31 export), oldest first."""
    result = await session.execute(
        select(
            SessionZeroPollVoteRow.room_id,
            SessionZeroPollRow.body,
            SessionZeroPollOptionRow.body,
            SessionZeroPollVoteRow.created_at,
        )
        .join(SessionZeroPollRow, SessionZeroPollRow.id == SessionZeroPollVoteRow.poll_id)
        .join(
            SessionZeroPollOptionRow,
            SessionZeroPollOptionRow.id == SessionZeroPollVoteRow.option_id,
        )
        .where(SessionZeroPollVoteRow.user_id == user_id)
        .order_by(SessionZeroPollVoteRow.created_at)
    )
    return [(room_id, poll, option, at) for room_id, poll, option, at in result.all()]
