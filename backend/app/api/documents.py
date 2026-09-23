import uuid
from collections.abc import Mapping

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    get_visible_document,
    get_visible_images,
    get_visible_images_for_documents,
    require_membership,
)
from app.api.image_uploads import (
    ImageResponse,
    ensure_room_for_another_image,
    fetch_url,
    image_responses,
    read_upload,
    remove_images,
    sign_images,
    store_image,
)
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, rooms_repo, tags_repo
from app.db.session import SessionDep
from app.domain.documents import (
    AlreadyOwnerError,
    DocumentNameRequiredError,
    NotAnOwnerError,
    NotOwnerError,
    can_create_document,
    ensure_can_remove_owner,
    ensure_owner,
    plan_add_owner,
    plan_new_document,
)
from app.domain.models import Document, DocumentImage, DocumentVisibility, Membership
from app.domain.visibility import is_document_visible

router = APIRouter(prefix="/rooms/{room_id}/documents", tags=["documents"])


class DocumentResponse(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    visibility: DocumentVisibility
    # Filtered per viewer: an image attached to a Comment is listed only
    # for those who can read that Comment.
    images: list[ImageResponse]
    tag_ids: list[uuid.UUID]
    owner_ids: list[uuid.UUID]
    selective_user_ids: list[uuid.UUID]


class ImageFromUrlRequest(BaseModel):
    url: HttpUrl


class CreateDocumentRequest(BaseModel):
    name: str
    description: str = ""
    visibility: DocumentVisibility = DocumentVisibility.ROOM
    tag_ids: UniqueIds = []
    selective_user_ids: UniqueIds = []


class UpdateDocumentRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    visibility: DocumentVisibility | None = None
    tag_ids: UniqueIds | None = None
    selective_user_ids: UniqueIds | None = None


def _build_response(
    document: Document,
    owner_ids: list[uuid.UUID],
    selective_ids: list[uuid.UUID],
    tag_ids: list[uuid.UUID],
    images: list[DocumentImage],
    image_urls: Mapping[str, str],
) -> DocumentResponse:
    """`images` must already be filtered for the viewer
    (`get_visible_images`) and signed (`sign_images`)."""
    return DocumentResponse(
        id=document.id,
        room_id=document.room_id,
        name=document.name,
        description=document.description,
        visibility=document.visibility,
        images=image_responses(images, image_urls),
        tag_ids=tag_ids,
        owner_ids=owner_ids,
        selective_user_ids=selective_ids,
    )


async def _to_response(
    session: AsyncSession, document: Document, viewer: Membership
) -> DocumentResponse:
    owner_ids = await documents_repo.list_owner_ids(session, document.id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document.id)
    tag_ids = await documents_repo.list_tag_ids_for_document(session, document.id)
    images = await get_visible_images(session, document.id, viewer)
    return _build_response(
        document, owner_ids, selective_ids, tag_ids, images, await sign_images(images)
    )


async def _validate_tag_ids(
    session: AsyncSession, room_id: uuid.UUID, tag_ids: list[uuid.UUID]
) -> None:
    found = await tags_repo.get_tags_by_ids(session, room_id, tag_ids)
    if len(found) != len(set(tag_ids)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "One or more tag_ids are invalid for this room"
        )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_document(
    room_id: uuid.UUID,
    body: CreateDocumentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id)

    room = await rooms_repo.get_room(session, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    if not can_create_document(membership.role, room.players_can_create_documents):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Document creation is disabled for Players in this Room"
        )

    try:
        plan = plan_new_document(
            room_id, body.name, body.description, body.visibility, requester_id
        )
    except DocumentNameRequiredError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    await _validate_tag_ids(session, room_id, body.tag_ids)
    await documents_repo.insert_new_document(session, plan, body.tag_ids, body.selective_user_ids)

    return await _to_response(session, plan.document, membership)


@router.get("")
async def list_documents(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep
) -> list[DocumentResponse]:
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id)

    documents = await documents_repo.list_documents_for_room(session, room_id)
    document_ids = [document.id for document in documents]

    # Every card carries its Tags and its images, so the whole page is read in
    # a fixed number of queries instead of a handful per Document.
    owners = await documents_repo.list_owner_ids_for_documents(session, document_ids)
    grants = await documents_repo.list_selective_grant_ids_for_documents(session, document_ids)

    visible = [
        document
        for document in documents
        if is_document_visible(
            document, requester_id, membership.role, owners[document.id], grants[document.id]
        )
    ]
    # Tags and images are read only for the Documents that survived the
    # visibility filter (Invariant 1), never for the whole Room.
    visible_ids = [document.id for document in visible]
    tags = await documents_repo.list_tag_ids_for_documents(session, visible_ids)
    images = await get_visible_images_for_documents(session, visible_ids, membership)

    # One signing request for the whole list, not one per Document.
    image_urls = await sign_images(
        image for document_images in images.values() for image in document_images
    )
    return [
        _build_response(
            document,
            owners[document.id],
            grants[document.id],
            tags[document.id],
            images.get(document.id, []),
            image_urls,
        )
        for document in visible
    ]


@router.get("/{document_id}")
async def get_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id)

    document, _, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    return await _to_response(session, document, membership)


async def _get_owned_document(
    session: AsyncSession, room_id: uuid.UUID, document_id: uuid.UUID, requester_id: uuid.UUID
) -> tuple[Document, list[uuid.UUID], Membership]:
    """Returns (document, owner_ids, membership) once the requester is known
    to see the Document and to be one of its Owners (D-12)."""
    membership = await require_membership(session, room_id, requester_id)
    document, owner_ids, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    try:
        ensure_owner(membership.role, requester_id, owner_ids)
    except NotOwnerError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return document, owner_ids, membership


@router.patch("/{document_id}")
async def update_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: UpdateDocumentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await _get_owned_document(session, room_id, document_id, requester_id)

    new_name = document.name if body.name is None else body.name.strip()
    if body.name is not None and not new_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Document name is required")

    updated = Document(
        id=document.id,
        room_id=document.room_id,
        name=new_name,
        description=document.description if body.description is None else body.description,
        visibility=document.visibility if body.visibility is None else body.visibility,
        created_by=document.created_by,
    )
    await documents_repo.update_document(session, updated)

    if body.tag_ids is not None:
        await _validate_tag_ids(session, room_id, body.tag_ids)
        await documents_repo.set_document_tags(session, document_id, body.tag_ids)

    if body.selective_user_ids is not None:
        await documents_repo.set_selective_grants(session, document_id, body.selective_user_ids)

    return await _to_response(session, updated, membership)


@router.post("/{document_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await _get_owned_document(session, room_id, document_id, requester_id)
    current_images = await ensure_room_for_another_image(session, document)
    data = await read_upload(file)
    await store_image(session, document, requester_id, data, current_images)
    return await _to_response(session, document, membership)


@router.post("/{document_id}/images/from-url", status_code=status.HTTP_201_CREATED)
async def import_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: ImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await _get_owned_document(session, room_id, document_id, requester_id)
    current_images = await ensure_room_for_another_image(session, document)
    data = await fetch_url(str(body.url))
    await store_image(session, document, requester_id, data, current_images)
    return await _to_response(session, document, membership)


@router.delete("/{document_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    """An Owner (or the Master) manages every image in the Document's gallery,
    including Comment attachments - but only those they can see."""
    requester_id = uuid.UUID(current_user.id)
    _, _, membership = await _get_owned_document(session, room_id, document_id, requester_id)

    images = await get_visible_images(session, document_id, membership)
    image = next((i for i in images if i.id == image_id), None)
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    await remove_images(session, [image])


@router.put("/{document_id}/images/{image_id}/favorite")
async def set_favorite_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    """Spec 07: an Owner (or the Master, D-12) picks the image that leads the
    Document. Only one at a time, so this clears the previous favorite.

    The image must be one the requester can actually see - otherwise an Owner
    could probe for a Private Comment's attachment by trying ids (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await _get_owned_document(session, room_id, document_id, requester_id)

    images = await get_visible_images(session, document_id, membership)
    if not any(image.id == image_id for image in images):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    await documents_repo.set_favorite_image(session, document_id, image_id)
    return await _to_response(session, document, membership)


@router.post("/{document_id}/owners/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_owner(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    document, owner_ids, membership = await _get_owned_document(
        session, room_id, document_id, requester_id
    )

    target_membership = await rooms_repo.get_membership(session, room_id, user_id)
    if target_membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User is not a member of this room")

    try:
        new_owner = plan_add_owner(document_id, user_id, owner_ids)
    except AlreadyOwnerError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    await documents_repo.insert_owner(session, new_owner.document_id, new_owner.user_id)
    return await _to_response(session, document, membership)


@router.delete("/{document_id}/owners/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_owner(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    requester_id = uuid.UUID(current_user.id)
    _, owner_ids, _ = await _get_owned_document(session, room_id, document_id, requester_id)

    try:
        ensure_can_remove_owner(user_id, owner_ids)
    except NotAnOwnerError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    await documents_repo.delete_owner(session, document_id, user_id)
