import asyncio
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, remote_images, rooms_repo, storage, tags_repo
from app.db.remote_images import RemoteImageError
from app.db.session import SessionDep
from app.domain.documents import (
    AlreadyOwnerError,
    DocumentNameRequiredError,
    NotAnOwnerError,
    NotOwnerError,
    TooManyImagesError,
    can_create_document,
    ensure_can_add_image,
    ensure_can_remove_owner,
    ensure_owner,
    plan_add_owner,
    plan_new_document,
    plan_new_image,
)
from app.domain.images import (
    MAX_INPUT_BYTES,
    ImageTooLargeError,
    InvalidImageError,
    normalize_image,
)
from app.domain.models import Document, DocumentImage, DocumentVisibility, RoomRole
from app.domain.visibility import is_document_visible

router = APIRouter(prefix="/rooms/{room_id}/documents", tags=["documents"])


class DocumentImageResponse(BaseModel):
    id: uuid.UUID
    url: str


class DocumentResponse(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    visibility: DocumentVisibility
    images: list[DocumentImageResponse]
    tag_ids: list[uuid.UUID]
    owner_ids: list[uuid.UUID]
    selective_user_ids: list[uuid.UUID]


class ImageFromUrlRequest(BaseModel):
    url: HttpUrl


class CreateDocumentRequest(BaseModel):
    name: str
    description: str = ""
    visibility: DocumentVisibility = DocumentVisibility.ROOM
    tag_ids: list[uuid.UUID] = []
    selective_user_ids: list[uuid.UUID] = []


class UpdateDocumentRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    visibility: DocumentVisibility | None = None
    tag_ids: list[uuid.UUID] | None = None
    selective_user_ids: list[uuid.UUID] | None = None


def _image_response(image: DocumentImage) -> DocumentImageResponse:
    return DocumentImageResponse(id=image.id, url=storage.public_url(image.storage_path))


async def _build_response(
    session: AsyncSession,
    document: Document,
    owner_ids: list[uuid.UUID],
    selective_ids: list[uuid.UUID],
) -> DocumentResponse:
    tag_ids = await documents_repo.list_tag_ids_for_document(session, document.id)
    images = await documents_repo.list_images(session, document.id)
    return DocumentResponse(
        id=document.id,
        room_id=document.room_id,
        name=document.name,
        description=document.description,
        visibility=document.visibility,
        images=[_image_response(image) for image in images],
        tag_ids=tag_ids,
        owner_ids=owner_ids,
        selective_user_ids=selective_ids,
    )


async def _to_response(session: AsyncSession, document: Document) -> DocumentResponse:
    owner_ids = await documents_repo.list_owner_ids(session, document.id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document.id)
    return await _build_response(session, document, owner_ids, selective_ids)


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
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

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

    return await _to_response(session, plan.document)


@router.get("")
async def list_documents(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep
) -> list[DocumentResponse]:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    documents = await documents_repo.list_documents_for_room(session, room_id)
    responses = []
    for document in documents:
        owner_ids = await documents_repo.list_owner_ids(session, document.id)
        selective_ids = await documents_repo.list_selective_grant_ids(session, document.id)
        if not is_document_visible(
            document, requester_id, membership.role, owner_ids, selective_ids
        ):
            continue
        responses.append(await _build_response(session, document, owner_ids, selective_ids))
    return responses


async def _get_visible_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    requester_id: uuid.UUID,
    role: RoomRole,
) -> tuple[Document, list[uuid.UUID], list[uuid.UUID]]:
    document = await documents_repo.get_document(session, document_id)
    if document is None or document.room_id != room_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    owner_ids = await documents_repo.list_owner_ids(session, document_id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document_id)
    if not is_document_visible(document, requester_id, role, owner_ids, selective_ids):
        # Not found, not forbidden - a Document you can't see doesn't
        # exist as far as you're concerned (VR-07).
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    return document, owner_ids, selective_ids


@router.get("/{document_id}")
async def get_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    document, _, _ = await _get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    return await _to_response(session, document)


@router.patch("/{document_id}")
async def update_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: UpdateDocumentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    document, owner_ids, _ = await _get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    try:
        ensure_owner(membership.role, requester_id, owner_ids)
    except NotOwnerError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

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

    return await _to_response(session, updated)


async def _get_owned_document(
    session: AsyncSession, room_id: uuid.UUID, document_id: uuid.UUID, requester_id: uuid.UUID
) -> Document:
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    document, owner_ids, _ = await _get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    try:
        ensure_owner(membership.role, requester_id, owner_ids)
    except NotOwnerError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return document


async def _ensure_room_for_another_image(session: AsyncSession, document: Document) -> int:
    current_count = len(await documents_repo.list_images(session, document.id))
    try:
        ensure_can_add_image(current_count)
    except TooManyImagesError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return current_count


async def _store_image(
    session: AsyncSession,
    document: Document,
    uploader_id: uuid.UUID,
    data: bytes,
    current_count: int,
) -> DocumentResponse:
    """Shared tail of both image sources: normalize -> upload -> record.
    The Storage upload happens before the row insert; if the insert fails,
    the just-uploaded object is removed again so nothing is orphaned."""
    try:
        normalized = await asyncio.to_thread(normalize_image, data)
    except ImageTooLargeError as exc:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(exc)) from exc
    except InvalidImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    try:
        image = plan_new_image(
            document.room_id, document.id, normalized.extension, uploader_id, current_count
        )
    except TooManyImagesError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    try:
        await storage.upload(image.storage_path, normalized.data, normalized.content_type)
    except storage.StorageError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Image storage is unavailable") from exc
    try:
        await documents_repo.insert_image(session, image)
    except Exception:
        await storage.remove(image.storage_path)
        raise

    return await _to_response(session, document)


@router.post("/{document_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    document = await _get_owned_document(session, room_id, document_id, requester_id)
    current_count = await _ensure_room_for_another_image(session, document)

    # Read one byte past the limit so an oversized file is detectable
    # without buffering all of it.
    data = await file.read(MAX_INPUT_BYTES + 1)
    return await _store_image(session, document, requester_id, data, current_count)


@router.post("/{document_id}/images/from-url", status_code=status.HTTP_201_CREATED)
async def import_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: ImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    document = await _get_owned_document(session, room_id, document_id, requester_id)
    current_count = await _ensure_room_for_another_image(session, document)

    try:
        data = await remote_images.fetch_image_bytes(str(body.url))
    except RemoteImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return await _store_image(session, document, requester_id, data, current_count)


@router.delete("/{document_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    requester_id = uuid.UUID(current_user.id)
    await _get_owned_document(session, room_id, document_id, requester_id)

    images = await documents_repo.list_images(session, document_id)
    image = next((i for i in images if i.id == image_id), None)
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    await documents_repo.delete_image(session, image_id)
    try:
        await storage.remove(image.storage_path)
    except storage.StorageError as exc:
        # Raising rolls the row deletion back too, so DB and bucket stay in step.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Image storage is unavailable") from exc


@router.post("/{document_id}/owners/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_owner(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> DocumentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    document, owner_ids, _ = await _get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    try:
        ensure_owner(membership.role, requester_id, owner_ids)
    except NotOwnerError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    target_membership = await rooms_repo.get_membership(session, room_id, user_id)
    if target_membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User is not a member of this room")

    try:
        new_owner = plan_add_owner(document_id, user_id, owner_ids)
    except AlreadyOwnerError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    await documents_repo.insert_owner(session, new_owner.document_id, new_owner.user_id)
    return await _to_response(session, document)


@router.delete("/{document_id}/owners/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_owner(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    _, owner_ids, _ = await _get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    try:
        ensure_owner(membership.role, requester_id, owner_ids)
    except NotOwnerError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    try:
        ensure_can_remove_owner(user_id, owner_ids)
    except NotAnOwnerError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    await documents_repo.delete_owner(session, document_id, user_id)
