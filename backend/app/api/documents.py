"""Documents (FR-D1, FR-D2): CRUD, their images and their Owners. Every read
goes through the visibility filter first (Invariant 1), and every change
requires Ownership - which the Master always has (D-12)."""

import uuid
from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    get_document_notes,
    get_owned_document,
    get_visible_document,
    get_visible_images,
    get_visible_images_for_documents,
    require_membership,
)
from app.api.document_files import FileResponse, file_responses, remove_files, sign_files
from app.api.errors import http_error, translated_error
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
from app.api.mentions import clean_content_mentions, index_mentions
from app.api.notes import NoteResponse, visible_note_responses
from app.api.reveals import (
    RevealDocumentRequest,
    RevealedInDocument,
    audience_of,
    ensure_audience_members,
    ensure_master,
    mark_document_reveals_seen,
    record_reveal,
    reveal_error,
)
from app.api.validation import UniqueIds
from app.api.versions import record_version
from app.auth.dependencies import CurrentUserDep
from app.db import (
    comments_repo,
    documents_repo,
    files_repo,
    notes_repo,
    reads_repo,
    rooms_repo,
    tags_repo,
)
from app.db.session import SessionDep
from app.domain.characters import PlayerNotAMemberError, plan_player_change
from app.domain.documents import (
    AlreadyOwnerError,
    DocumentNameRequiredError,
    NotAnOwnerError,
    can_create_document,
    document_visibility_audit,
    ensure_can_remove_owner,
    plan_add_owner,
    plan_new_document,
)
from app.domain.models import (
    ContentKind,
    Document,
    DocumentImage,
    DocumentVisibility,
    Membership,
    MentionSource,
    MentionSourceKind,
)
from app.domain.reads import unread_counts
from app.domain.reveal import (
    RevealAudienceRequiredError,
    RevealNotWideningError,
    RevealTarget,
    plan_reveal,
)
from app.domain.rooms import starting_visibility
from app.domain.visibility import is_content_visible, is_document_visible, starting_grants
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/documents", tags=["documents"])


class DocumentResponse(BaseModel):
    """A Document as every route serializes it, filtered for the requester."""

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
    # The member who plays this Document as a Character (D-23), or None. Like
    # `owner_ids`, a user id the client resolves through the members list.
    played_by: uuid.UUID | None


class DocumentDetailResponse(DocumentResponse):
    """One Document, as the single-Document routes return it: the list's
    fields plus its Notes (spec 12), filtered for the requester like
    everything else, and its PDF Attachments (spec 16), which have the
    Document's own visibility (VR-12). The list leaves both out - a card shows
    neither, and the list is read in a fixed number of queries."""

    notes: list[NoteResponse]
    files: list[FileResponse]
    # When the requester last opened the Document (spec 19b), None if never.
    # `POST .../read` moves it to now; the page reads it first, so it can mark
    # the Comments created since as "New".
    last_read_at: datetime | None


class DocumentListItemResponse(DocumentResponse):
    """A Document as the list returns it: the card's fields plus how many
    Comments and replies are new to the requester since they last opened it
    (spec 19b), counted only among those they can see (VR-07). None when they
    never opened it: the card shows "not yet read" rather than a count."""

    unread_count: int | None


class DocumentReadResponse(BaseModel):
    """The requester's visit recorded by `POST .../read` (spec 19b): the time
    it was recorded, and the previous visit (None on the first one), so the
    page can mark what is new even if it read the Document after this call."""

    last_read_at: datetime
    previous_read_at: datetime | None
    # What this visit opened among the content revealed to the requester
    # (spec 22): the page marks it "Revealed" for this visit.
    revealed: RevealedInDocument


class SetPlayerRequest(BaseModel):
    """The member who plays the Document as a Character, or null to unlink it
    (D-23). `add_as_owner` also makes them an Owner, so they can edit their
    sheet (spec 17's default)."""

    user_id: uuid.UUID | None
    add_as_owner: bool = True


class ImageFromUrlRequest(BaseModel):
    """An image to import from a URL instead of uploading a file."""

    url: HttpUrl


class CreateDocumentRequest(BaseModel):
    """A new Document. Tags must belong to the Room; repeated ids are
    dropped. Without `visibility` it starts at the Room's default (VR-05)."""

    name: str
    description: str = ""
    visibility: DocumentVisibility | None = None
    tag_ids: UniqueIds = []
    selective_user_ids: UniqueIds = []


class UpdateDocumentRequest(BaseModel):
    """A partial update: omitted fields are left as they are. A list that is
    sent replaces the current one."""

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
        played_by=document.played_by,
    )


async def _to_response(
    session: AsyncSession, document: Document, viewer: Membership
) -> DocumentDetailResponse:
    """Reads everything a single Document's response needs and serializes it
    for `viewer`."""
    owner_ids = await documents_repo.list_owner_ids(session, document.id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document.id)
    tag_ids = await documents_repo.list_tag_ids_for_document(session, document.id)
    images = await get_visible_images(session, document.id, viewer)
    notes = await get_document_notes(session, document.id, viewer, owner_ids)
    files = await files_repo.list_files(session, document.id)
    last_read_at = await reads_repo.get_last_read_at(session, viewer.user_id, document.id)
    base = _build_response(
        document, owner_ids, selective_ids, tag_ids, images, await sign_images(images)
    )
    return DocumentDetailResponse(
        **base.model_dump(),
        notes=visible_note_responses(notes, viewer, owner_ids),
        files=file_responses(files, await sign_files(files), viewer, owner_ids),
        last_read_at=last_read_at,
    )


async def _validate_tag_ids(
    session: AsyncSession, room_id: uuid.UUID, tag_ids: list[uuid.UUID], locale: str
) -> None:
    """422 unless every id is a Tag of this Room - a Document can't be tagged
    with another Room's Tag."""
    found = await tags_repo.get_tags_by_ids(session, room_id, tag_ids)
    if len(found) != len(set(tag_ids)):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.document.invalidTagIds", locale
        )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_document(
    room_id: uuid.UUID,
    body: CreateDocumentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """UC-06: creates a Document with the requester as its Owner, at the
    Room's default visibility unless the request names one (VR-05). 403 when
    the Room has disabled Document creation for Players (D-13, FR-D7)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)

    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    if not can_create_document(membership.role, room.players_can_create_documents):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.document.creationDisabled", locale)

    description = await clean_content_mentions(session, membership, body.description)
    try:
        plan = plan_new_document(
            room_id,
            body.name,
            description,
            starting_visibility(room, body.visibility),
            requester_id,
        )
    except DocumentNameRequiredError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await _validate_tag_ids(session, room_id, body.tag_ids, locale)
    await documents_repo.insert_new_document(
        session,
        plan,
        body.tag_ids,
        starting_grants(plan.document.visibility, body.selective_user_ids),
    )
    await index_mentions(
        session,
        MentionSource(plan.document.id, MentionSourceKind.DESCRIPTION),
        plan.document.description,
    )
    await record_version(
        session,
        "document",
        plan.document.id,
        plan.document.id,
        requester_id,
        plan.document.name,
        plan.document.description,
    )

    return await _to_response(session, plan.document, membership)


@router.get("")
async def list_documents(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[DocumentListItemResponse]:
    """Every Document in the Room the requester can see (VR-07), each with its
    Tags, visible images and unread count (spec 19b), in a fixed number of
    queries."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)

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
    unread = await _unread_counts(session, visible_ids, membership)
    return [
        DocumentListItemResponse(
            **_build_response(
                document,
                owners[document.id],
                grants[document.id],
                tags[document.id],
                images.get(document.id, []),
                image_urls,
            ).model_dump(),
            unread_count=unread[document.id],
        )
        for document in visible
    ]


async def _unread_counts(
    session: AsyncSession, document_ids: list[uuid.UUID], viewer: Membership
) -> dict[uuid.UUID, int | None]:
    """The unread count of each Document (spec 19b) for the whole list at
    once: the viewer's reads, the Comments created since, their ancestors
    (one query per level of the deepest branch) and grants - never a query
    per Document (NFR-04). Filtered with the Thread's own effective
    visibility, so a count never reveals a hidden post (VR-07)."""
    last_read = await reads_repo.list_last_read_for_documents(session, viewer.user_id, document_ids)
    candidates = await reads_repo.list_comments_since_last_read(
        session, viewer.user_id, list(last_read)
    )
    comments = await comments_repo.get_comments_with_ancestors(
        session, [comment.parent_id for comment in candidates if comment.parent_id is not None]
    )
    comments.update((comment.id, comment) for comment in candidates)
    grants = await comments_repo.list_grants_for_comments(session, list(comments))
    return unread_counts(
        document_ids, last_read, candidates, comments, grants, viewer.user_id, viewer.role
    )


@router.get("/{document_id}")
async def get_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """One Document; 404 whether it doesn't exist or the requester can't see it
    (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)

    document, _, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role, locale
    )
    return await _to_response(session, document, membership)


@router.post("/{document_id}/read")
async def mark_document_read(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentReadResponse:
    """Spec 19b: the requester opened the Document, so what was posted until
    now is no longer new to them. Any member who sees the Document (404
    otherwise, VR-07); calling it again only moves the time forward. The
    previous visit comes back so the page can still mark what is new. It
    also opens what was revealed to them in the Document, its Notes and its
    Comments (spec 22), and says which, so the page can mark it "Revealed"."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    await get_visible_document(session, room_id, document_id, requester_id, membership.role, locale)
    now = datetime.now(UTC)
    previous = await reads_repo.mark_read(session, requester_id, document_id, now)
    revealed = await mark_document_reveals_seen(session, membership, document_id, now)
    return DocumentReadResponse(last_read_at=now, previous_read_at=previous, revealed=revealed)


@router.patch("/{document_id}")
async def update_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: UpdateDocumentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """UC-07: an Owner (or the Master, D-12) edits the Document's fields, Tags
    and Selective grants. A change of who can see it is audited in the same
    transaction (VR-08, Invariant 7)."""
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )
    selective_ids = await documents_repo.list_selective_grant_ids(session, document_id)

    new_name = document.name if body.name is None else body.name.strip()
    if body.name is not None and not new_name:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.document.nameRequired", locale
        )

    description = (
        document.description
        if body.description is None
        else await clean_content_mentions(
            session, membership, body.description, previous=document.description
        )
    )
    updated = replace(
        document,
        name=new_name,
        description=description,
        visibility=document.visibility if body.visibility is None else body.visibility,
    )
    await documents_repo.update_document(session, updated)
    if body.description is not None:
        await index_mentions(
            session, MentionSource(document_id, MentionSourceKind.DESCRIPTION), description
        )
    if body.name is not None or body.description is not None:
        await record_version(
            session, "document", document_id, document_id, requester_id, new_name, description
        )

    if body.tag_ids is not None:
        await _validate_tag_ids(session, room_id, body.tag_ids, locale)
        await documents_repo.set_document_tags(session, document_id, body.tag_ids)

    if body.selective_user_ids is not None:
        await documents_repo.set_selective_grants(session, document_id, body.selective_user_ids)

    audit_entry = document_visibility_audit(
        document, updated, requester_id, selective_ids, body.selective_user_ids
    )
    if audit_entry is not None:
        await rooms_repo.insert_audit_log(session, audit_entry)

    return await _to_response(session, updated, membership)


@router.post("/{document_id}/reveal")
async def reveal_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: RevealDocumentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """UC-13/FR-V2: the Master reveals the Document to the whole Room, or to
    chosen members added to who already sees it, together with any of its
    Notes listed in `note_ids` (spec 22 Decisions 1-2); its Comments are never
    carried along. Only ever widens: 422 when nobody would gain access to the
    Document or to one of the Notes, or for a Note that isn't one of its own.
    403 for anyone but the Master, 404 for a Document they can't see. Every
    member who gains access is told (`GET /reveals/mine`), and each Reveal is
    audited in the same transaction (VR-06, Invariant 7)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    # Locked before anything is read: the levels planned from are the ones
    # written over.
    await documents_repo.lock_document(session, document_id)
    document, owner_ids, selective_ids = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role, locale
    )
    ensure_master(membership, locale)
    await ensure_audience_members(session, room_id, body, locale)

    members = await rooms_repo.list_memberships(session, room_id)
    owners = frozenset(owner_ids)
    audience = audience_of(body)
    now = datetime.now(UTC)
    try:
        plan = plan_reveal(
            RevealTarget(ContentKind.DOCUMENT, document_id, owner_ids=owners),
            document.visibility,
            selective_ids,
            audience,
            members,
            lambda member, visibility, grants: is_content_visible(
                visibility, member.user_id, member.role, owners, grants
            ),
            room_id,
            requester_id,
            now,
        )
    except (RevealAudienceRequiredError, RevealNotWideningError) as exc:
        raise reveal_error(exc, locale) from exc

    notes = await get_document_notes(session, document_id, membership, owner_ids)
    notes_by_id = {note.id: note for note in notes.every}
    if not set(body.note_ids) <= notes_by_id.keys():
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.reveal.invalidNotes", locale
        )

    def sees_document_after(member: Membership) -> bool:
        """Whether the member sees the Document once it is revealed."""
        return is_content_visible(
            plan.visibility, member.user_id, member.role, owners, plan.selective_user_ids
        )

    note_plans = []
    for note_id in body.note_ids:
        note = notes_by_id[note_id]
        try:
            note_plans.append(
                (
                    note,
                    plan_reveal(
                        RevealTarget(
                            ContentKind.NOTE, document_id, note_id=note_id, owner_ids=owners
                        ),
                        note.visibility,
                        notes.grants[note_id],
                        audience,
                        members,
                        lambda member, visibility, grants: (
                            sees_document_after(member)
                            and is_content_visible(
                                visibility, member.user_id, member.role, owners, grants
                            )
                        ),
                        room_id,
                        requester_id,
                        now,
                    ),
                )
            )
        except (RevealAudienceRequiredError, RevealNotWideningError) as exc:
            raise reveal_error(exc, locale) from exc

    revealed = replace(document, visibility=plan.visibility)
    await documents_repo.update_document(session, revealed)
    await documents_repo.set_selective_grants(session, document_id, sorted(plan.selective_user_ids))
    await record_reveal(session, plan)
    for note, note_plan in note_plans:
        await notes_repo.update_note(session, replace(note, visibility=note_plan.visibility))
        await notes_repo.set_note_grants(session, note.id, sorted(note_plan.selective_user_ids))
        await record_reveal(session, note_plan)
    return await _to_response(session, revealed, membership)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """An Owner (or the Master, D-12) permanently deletes the Document, along
    with its Comments, Notes, images, PDF Attachments and
    Tag/Owner/Selective-grant links."""
    requester_id = uuid.UUID(current_user.id)
    document, _, _ = await get_owned_document(session, room_id, document_id, requester_id, locale)

    # Locked first so a concurrent image or file upload can't insert a row
    # the cascade below would then delete without ever scheduling its Storage
    # object for cleanup.
    await documents_repo.lock_document(session, document_id)
    images = await documents_repo.list_images(session, document_id)
    if images:
        await remove_images(session, images)
    files = await files_repo.list_files(session, document_id)
    if files:
        await remove_files(session, files)
    await documents_repo.delete_document(session, document.id)


@router.post("/{document_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """An Owner adds an uploaded image, up to `MAX_IMAGES_PER_DOCUMENT` (409
    beyond). The first image becomes the favorite (spec 07)."""
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )
    current_images = await ensure_room_for_another_image(session, document, locale)
    data = await read_upload(file)
    await store_image(session, document, requester_id, data, current_images, locale=locale)
    return await _to_response(session, document, membership)


@router.post("/{document_id}/images/from-url", status_code=status.HTTP_201_CREATED)
async def import_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: ImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """Like `upload_document_image`, with the image fetched from a URL."""
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )
    current_images = await ensure_room_for_another_image(session, document, locale)
    data = await fetch_url(str(body.url), locale)
    await store_image(session, document, requester_id, data, current_images, locale=locale)
    return await _to_response(session, document, membership)


@router.delete("/{document_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """An Owner (or the Master) manages every image in the Document's gallery,
    including Comment attachments - but only those they can see."""
    requester_id = uuid.UUID(current_user.id)
    _, _, membership = await get_owned_document(session, room_id, document_id, requester_id, locale)

    images = await get_visible_images(session, document_id, membership)
    image = next((i for i in images if i.id == image_id), None)
    if image is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.image.notFound", locale)
    await remove_images(session, [image])


@router.put("/{document_id}/images/{image_id}/favorite")
async def set_favorite_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """Spec 07: an Owner (or the Master, D-12) picks the image that leads the
    Document. Only one at a time, so this clears the previous favorite.

    The image must be one the requester can actually see - otherwise an Owner
    could probe for a Private Comment's attachment by trying ids (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )

    # Locked before the image is read, not just inside `set_favorite_image`:
    # a concurrent delete of this image between the check and the write would
    # otherwise clear the old favorite and set nothing, leaving the Document
    # with images and no favorite.
    await documents_repo.lock_document(session, document_id)
    images = await get_visible_images(session, document_id, membership)
    if not any(image.id == image_id for image in images):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.image.notFound", locale)

    await documents_repo.set_favorite_image(session, document_id, image_id)
    return await _to_response(session, document, membership)


@router.post("/{document_id}/owners/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_owner(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """UC-08: an Owner makes another member an Owner too. 404 when the user
    isn't in the Room, 409 when they already own it."""
    requester_id = uuid.UUID(current_user.id)
    document, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )

    target_membership = await rooms_repo.get_membership(session, room_id, user_id)
    if target_membership is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.membership.notFound", locale)

    try:
        new_owner = plan_add_owner(document_id, user_id, owner_ids)
    except AlreadyOwnerError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    await documents_repo.insert_owner(session, new_owner.document_id, new_owner.user_id)
    return await _to_response(session, document, membership)


@router.delete("/{document_id}/owners/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_owner(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """UC-08: an Owner removes an explicit Owner - themselves included. The
    Master stays an implicit Owner, so a Document is never left unowned
    (D-12)."""
    requester_id = uuid.UUID(current_user.id)
    _, owner_ids, _ = await get_owned_document(session, room_id, document_id, requester_id, locale)

    try:
        ensure_can_remove_owner(user_id, owner_ids)
    except NotAnOwnerError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc

    await documents_repo.delete_owner(session, document_id, user_id)


@router.put("/{document_id}/player")
async def set_player(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: SetPlayerRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> DocumentDetailResponse:
    """UC-21/FR-D9: an Owner (or the Master, D-12) makes the Document a
    Character played by one member of the Room, changes who plays it, or
    unlinks it with `user_id: null` (D-23). 422 when the user isn't a member.
    The change, and the Owner added with `add_as_owner`, are audited in the
    same transaction (Invariant 7)."""
    requester_id = uuid.UUID(current_user.id)
    # Taken before anything is read, so the Document's current player and the
    # members are read as of the lock: serialized with `remove_member` (a
    # member leaving can't stay linked, D-15) and with a concurrent link (the
    # audited "from" is the real previous player).
    await rooms_repo.lock_room(session, room_id)
    document, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )

    member_ids = {m.user_id for m in await rooms_repo.list_memberships(session, room_id)}
    try:
        plan = plan_player_change(
            document, requester_id, owner_ids, member_ids, body.user_id, body.add_as_owner
        )
    except PlayerNotAMemberError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await documents_repo.set_played_by(session, document_id, plan.document.played_by)
    if plan.new_owner is not None:
        await documents_repo.insert_owner(session, document_id, plan.new_owner.user_id)
    for entry in plan.audit_entries:
        await rooms_repo.insert_audit_log(session, entry)
    return await _to_response(session, plan.document, membership)
