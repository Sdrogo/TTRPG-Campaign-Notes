"""The DDI module of Session 0 (spec 47 Decisions 8 and 8a): the Master
picks the Room's Document that holds the DDI or makes one from the
template, and each Player who sees it accepts it once read. Every write
answers with the open round's boards, like the rest of Session 0
(`app/api/session_zero.py`)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_document
from app.api.errors import http_error
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
from app.db import documents_repo, rooms_repo, session_zero_ddi_repo, session_zero_repo
from app.db.session import SessionDep
from app.domain.documents import plan_new_document
from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.rooms import starting_visibility
from app.domain.session_zero import Module, ensure_master
from app.domain.session_zero_ddi import ddi_template, ensure_can_accept, ensure_ddi_module
from app.domain.visibility import starting_grants
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate
from app.realtime.broker import Event

router = APIRouter(prefix=_session_zero_router.prefix, tags=["session-zero"])


class DdiDocumentBody(BaseModel):
    """The Room's Document that holds the DDI; null for none yet."""

    document_id: uuid.UUID | None


def _ddi_module(write: _Write, module_id: uuid.UUID, locale: str) -> Module:
    """A DDI module of the open round the caller has reached (404 otherwise,
    409 for a closed round's, 422 for another kind)."""
    module = _open_module(write, module_id, locale)
    ensure_ddi_module(module.kind)
    return module


async def _set_document(
    session: AsyncSession, write: _Write, module: Module, document_id: uuid.UUID | None
) -> None:
    """Points the module at another Document; acceptances of the old one
    no longer say anything, so they go."""
    if document_id == module.document_id:
        return
    await session_zero_repo.set_module_settings(session, module.id, document_id=document_id)
    await session_zero_ddi_repo.clear(session, module.id)
    await _shared(session, write.viewer.room_id, "module", module.id)


async def _acceptance_changed(
    session: AsyncSession, write: _Write, module: Module, user_id: uuid.UUID
) -> None:
    """An acceptance is the Player's and the Masters' to see, so only their
    streams hear of it, at the unchanged revision (Decision 12)."""
    room_id = write.viewer.room_id
    masters = [
        m.user_id
        for m in await rooms_repo.list_memberships(session, room_id)
        if m.role is RoomRole.MASTER
    ]
    for reader in {user_id, *masters}:
        _push(session, room_id, Event(write.revision, "accept", module.id), user_id=reader)


@router.put("/modules/{module_id}/document")
async def set_ddi_document(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    body: DdiDocumentBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 8: the Master picks the Room's Document that holds
    the DDI (422 for one of another Room). A new one clears the
    acceptances."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _ddi_module(write, module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if body.document_id is not None:
        document = await documents_repo.get_document(session, body.document_id)
        if document is None or document.room_id != room_id:
            raise http_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "errors.sessionZero.ddiDocumentInvalid",
                locale,
            )
    await _set_document(session, write, module, body.document_id)
    return await _answer(session, room_id, write, locale)


@router.post("/modules/{module_id}/document/template")
async def create_ddi_document(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 8a: the Master makes the DDI from the template, a
    new Document ("Declaration of Intent", the six sections and their
    checklist) at the Room's default visibility, the Master its creator and
    Owner, and the module shows it."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        module = _ddi_module(write, module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    plan = plan_new_document(
        room_id,
        translate("sessionZero.ddi.name", locale),
        ddi_template(lambda key: translate(f"sessionZero.ddi.{key}", locale)),
        starting_visibility(room, None),
        write.viewer.user_id,
    )
    await documents_repo.insert_new_document(
        session, plan, [], starting_grants(plan.document.visibility, [])
    )
    await record_revision(session, plan.document.id, write.viewer.user_id)
    await _set_document(session, write, module, plan.document.id)
    return await _answer(session, room_id, write, locale)


@router.post("/modules/{module_id}/acceptance")
async def accept_ddi(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 8: a Player who sees the DDI says "I have read and
    accept" (again, once it changed). 409 while there is no Document, 404
    for one they don't see (VR-07)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        module = _ddi_module(write, module_id, locale)
        document_id = ensure_can_accept(write.viewer.role, module.document_id)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await get_visible_document(
        session, room_id, document_id, write.viewer.user_id, write.viewer.role, locale
    )
    await session_zero_ddi_repo.accept(
        session, room_id, module.id, write.viewer.user_id, datetime.now(UTC)
    )
    await _acceptance_changed(session, write, module, write.viewer.user_id)
    return await _answer(session, room_id, write, locale)


@router.delete("/modules/{module_id}/acceptance")
async def withdraw_ddi_acceptance(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """A Player takes back their acceptance; none to take back changes
    nothing."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        module = _ddi_module(write, module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if await session_zero_ddi_repo.withdraw(session, module.id, write.viewer.user_id):
        await _acceptance_changed(session, write, module, write.viewer.user_id)
    return await _answer(session, room_id, write, locale)
