"""Characters (D-23 to D-25, spec 17): how a Character is shown on a Comment
written as it, and which Characters the caller may write as. Linking a
Character to its player is a Document route (`PUT .../documents/{id}/player`
in app/api/documents.py), next to the Owner routes it resembles."""

import uuid
from collections.abc import Collection, Iterable, Mapping

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_images_for_documents, require_membership
from app.api.image_uploads import sign_images
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo
from app.db.session import SessionDep
from app.domain.characters import postable_characters
from app.domain.models import Document, Membership, RoomRole
from app.domain.visibility import is_document_visible
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/characters", tags=["characters"])


class CharacterResponse(BaseModel):
    """A Character as a Comment or the composer's picker shows it: the
    Document's name and the image that leads it for this viewer (a signed
    link, or None when it has no image the viewer may see)."""

    document_id: uuid.UUID
    name: str
    image_url: str | None


async def _visible_documents(
    session: AsyncSession, documents: Iterable[Document], viewer: Membership
) -> list[Document]:
    """The Documents of the viewer's Room they may see (Invariant 1), with the
    Owners and grants read in two queries whatever their number."""
    candidates = [document for document in documents if document.room_id == viewer.room_id]
    ids = [document.id for document in candidates]
    owners = await documents_repo.list_owner_ids_for_documents(session, ids)
    grants = await documents_repo.list_selective_grant_ids_for_documents(session, ids)
    return [
        document
        for document in candidates
        if is_document_visible(
            document, viewer.user_id, viewer.role, owners[document.id], grants[document.id]
        )
    ]


async def _character_responses(
    session: AsyncSession, documents: list[Document], viewer: Membership
) -> list[CharacterResponse]:
    """Serializes Documents already known to be visible to `viewer`. The
    image is the first one the viewer may see in the gallery order (the
    favorite, unless it's a Comment attachment hidden from them), as on the
    Document's card; all of them are signed in one request."""
    images = await get_visible_images_for_documents(
        session, [document.id for document in documents], viewer
    )
    leading = {
        document.id: images[document.id][0] for document in documents if images.get(document.id)
    }
    urls = await sign_images(leading.values())
    return [
        CharacterResponse(
            document_id=document.id,
            name=document.name,
            image_url=(
                urls.get(leading[document.id].storage_path) if document.id in leading else None
            ),
        )
        for document in documents
    ]


async def visible_characters(
    session: AsyncSession, document_ids: Collection[uuid.UUID], viewer: Membership
) -> Mapping[uuid.UUID, CharacterResponse]:
    """The Characters among `document_ids` that `viewer` may see, keyed by
    Document id - a hidden one is simply absent (VR-13, I-13), so a Comment
    written as it shows its real author. A fixed number of queries whatever
    the number of Comments."""
    if not document_ids:
        return {}
    documents = await documents_repo.get_documents_by_ids(session, list(set(document_ids)))
    visible = await _visible_documents(session, documents, viewer)
    return {
        character.document_id: character
        for character in await _character_responses(session, visible, viewer)
    }


@router.get("/mine")
async def list_my_characters(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[CharacterResponse]:
    """The Characters the caller may write a Comment as, by name, for the
    composer's "Post as" picker (D-24): the Documents they play and can see,
    or, for the Master, every Document of the Room (NPCs included). Empty
    when there are none, and the picker is then hidden."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)

    if membership.role == RoomRole.MASTER:
        documents = await documents_repo.list_documents_for_room(session, room_id)
    else:
        documents = await documents_repo.list_documents_played_by(session, room_id, requester_id)
    visible = await _visible_documents(session, documents, membership)
    allowed = postable_characters(visible, requester_id, membership.role)
    return await _character_responses(session, allowed, membership)
