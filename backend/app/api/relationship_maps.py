"""Relationship maps (spec 28_1): a Room's free boards of Documents, text
cards, groups and arrows. Members only (403); a map hidden from the
requester is 404, checked before any permission (VR-07). Every read shows
the board as the requester sees it (`visible_board`, Invariant 1), and
follows `X-View-As` like any read."""

import uuid
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    ensure_room_members,
    get_visible_images_for_documents,
    require_membership,
    visible_documents,
)
from app.api.errors import http_error, translated_error
from app.api.image_uploads import ImageResponse, image_responses, sign_images
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, relationship_maps_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import Document, DocumentImage, DocumentVisibility, Membership
from app.domain.relationship_maps import (
    MAX_LABEL_OFFSET,
    ArrowDirection,
    ArrowEnd,
    Board,
    BoardDocumentNotFoundError,
    BoardImageNotFoundError,
    CardSize,
    InvalidBoardError,
    MapArrow,
    MapCard,
    MapColor,
    MapGroup,
    MapLimitError,
    MapNameRequiredError,
    MapTextTooLongError,
    MasterOnlyNotAllowedError,
    RelationshipMap,
    TooManyMapsError,
    can_create_map,
    can_manage_map,
    clean_map_fields,
    document_card_counts,
    ensure_room_for_another_map,
    is_map_visible,
    map_visibility_audit,
    plan_board_edit,
    visible_board,
)
from app.domain.rooms import starting_visibility
from app.domain.visibility import starting_grants
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/maps", tags=["maps"])


class MapResponse(BaseModel):
    """A map as the list shows it: `document_count` counts only the
    Documents the requester sees; `selective_user_ids` is sent only to who
    may manage the map (its creator and the Master), None otherwise."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    visibility: DocumentVisibility
    selective_user_ids: list[uuid.UUID] | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    document_count: int
    can_edit: bool


class MapDocumentResponse(BaseModel):
    """What a Document card shows of its Document: its name, subtitle, first
    image the requester sees (the favorite first) and Tags."""

    id: uuid.UUID
    name: str
    subtitle: str | None
    image: ImageResponse | None
    tag_ids: list[uuid.UUID]


class GroupBody(BaseModel):
    """A group as sent and returned: `x`, `y` is its top left corner."""

    id: uuid.UUID
    title: str | None = None
    color: MapColor = MapColor.DEFAULT
    struck: bool = False
    x: float
    y: float
    width: float
    height: float


class CardBody(BaseModel):
    """A card as sent: a Document card names `document_id`, a text card
    carries `text`. `caption` is a Document card's, replacing its subtitle on
    this map; `image_id` is a Document card's chosen image, instead of its
    Document's favorite; `size` and `master_only` are a text card's."""

    id: uuid.UUID
    document_id: uuid.UUID | None = None
    text: str | None = None
    group_id: uuid.UUID | None = None
    caption: str | None = None
    image_id: uuid.UUID | None = None
    size: CardSize = CardSize.NORMAL
    master_only: bool = False
    color: MapColor = MapColor.DEFAULT
    struck: bool = False
    x: float
    y: float


class CardResponse(CardBody):
    """A card as returned, with its Document's look on a Document card."""

    document: MapDocumentResponse | None


class ArrowEndBody(BaseModel):
    """One end of an arrow: a card or a group, exactly one of the two."""

    card_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None


class ArrowBody(BaseModel):
    """An arrow as sent and returned. `label` is the only label of a one-way
    arrow or a line, the one pointing at `to` on a two-way arrow;
    `reverse_label` the one pointing at `from_end`, two-way only. The
    positions are where each label sits along the arrow (0 at `from_end`, 1 at
    `to_end`), or null for the automatic placement."""

    id: uuid.UUID
    from_end: ArrowEndBody
    to_end: ArrowEndBody
    direction: ArrowDirection = ArrowDirection.FORWARD
    label: str | None = None
    reverse_label: str | None = None
    label_position: float | None = Field(default=None, ge=0, le=1)
    reverse_label_position: float | None = Field(default=None, ge=0, le=1)
    label_offset: float | None = Field(default=None, ge=-MAX_LABEL_OFFSET, le=MAX_LABEL_OFFSET)
    reverse_label_offset: float | None = Field(
        default=None, ge=-MAX_LABEL_OFFSET, le=MAX_LABEL_OFFSET
    )
    color: MapColor = MapColor.DEFAULT
    master_only: bool = False


class MapDetailResponse(MapResponse):
    """A map with its board as the requester sees it (Invariant 1)."""

    groups: list[GroupBody]
    cards: list[CardResponse]
    arrows: list[ArrowBody]


class CreateMapRequest(BaseModel):
    """A new, empty map. Without `visibility` it starts at the Room's
    default (VR-05)."""

    name: str
    description: str = ""
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds = []


class UpdateMapRequest(BaseModel):
    """A partial update: omitted fields are left as they are."""

    name: str | None = None
    description: str | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds | None = None


class BoardRequest(BaseModel):
    """The whole board as the editor sees it (Decision 12): new items with
    ids the client made up, the others with their own ids. What the editor
    sees and leaves out is deleted; what they can't see stays as it is."""

    groups: list[GroupBody] = []
    cards: list[CardBody] = []
    arrows: list[ArrowBody] = []


def _now() -> datetime:
    """The current time, in UTC."""
    return datetime.now(UTC)


async def _get_visible_map(
    session: AsyncSession, room_id: uuid.UUID, map_id: uuid.UUID, viewer: Membership, locale: str
) -> tuple[RelationshipMap, list[uuid.UUID]]:
    """The map and its Selective grants once the viewer is known to see it;
    404 otherwise, whether it doesn't exist, is another Room's or is hidden
    from them (VR-07)."""
    relationship_map = await relationship_maps_repo.get_map(session, map_id)
    # A mention map (spec 36) is reached through its Document only.
    if (
        relationship_map is None
        or relationship_map.room_id != room_id
        or relationship_map.source_document_id is not None
    ):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.map.notFound", locale)
    grants = (await relationship_maps_repo.list_grants_for_maps(session, [map_id]))[map_id]
    if not is_map_visible(relationship_map, viewer.user_id, viewer.role, grants):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.map.notFound", locale)
    return relationship_map, grants


async def _get_managed_map(
    session: AsyncSession, room_id: uuid.UUID, map_id: uuid.UUID, viewer: Membership, locale: str
) -> tuple[RelationshipMap, list[uuid.UUID]]:
    """`_get_visible_map`, then 403 unless the viewer may change the map
    (Decision 2), then the map re-read under its row lock, so edits and
    board saves of one map serialize."""
    relationship_map, grants = await _get_visible_map(session, room_id, map_id, viewer, locale)
    if not can_manage_map(relationship_map, viewer.user_id, viewer.role):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.map.notManager", locale)
    locked = await relationship_maps_repo.lock_map(session, map_id)
    if locked is None:  # pragma: no cover - only a concurrent deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.map.notFound", locale)
    return locked, grants


async def _visible_document_ids(
    session: AsyncSession, document_ids: Iterable[uuid.UUID], viewer: Membership
) -> set[uuid.UUID]:
    """Which of these Documents are the viewer's Room's and visible to them,
    in a fixed number of queries."""
    documents = await documents_repo.get_documents_by_ids(session, list(set(document_ids)))
    return {document.id for document in await visible_documents(session, documents, viewer)}


def _summary(
    relationship_map: RelationshipMap,
    grants: Collection[uuid.UUID],
    viewer: Membership,
    document_count: int,
) -> MapResponse:
    """A map's list entry for `viewer`."""
    can_edit = can_manage_map(relationship_map, viewer.user_id, viewer.role)
    return MapResponse(
        id=relationship_map.id,
        room_id=relationship_map.room_id,
        name=relationship_map.name,
        description=relationship_map.description,
        visibility=relationship_map.visibility,
        selective_user_ids=sorted(grants) if can_edit else None,
        created_by=relationship_map.created_by,
        created_at=relationship_map.created_at,
        updated_at=relationship_map.updated_at,
        document_count=document_count,
        can_edit=can_edit,
    )


def arrow_body(arrow: MapArrow) -> ArrowBody:
    """An arrow as returned; shared with the mention maps (spec 36)."""
    return ArrowBody(
        id=arrow.id,
        from_end=ArrowEndBody(card_id=arrow.from_end.card_id, group_id=arrow.from_end.group_id),
        to_end=ArrowEndBody(card_id=arrow.to_end.card_id, group_id=arrow.to_end.group_id),
        direction=arrow.direction,
        label=arrow.label,
        reverse_label=arrow.reverse_label,
        label_position=arrow.label_position,
        reverse_label_position=arrow.reverse_label_position,
        label_offset=arrow.label_offset,
        reverse_label_offset=arrow.reverse_label_offset,
        color=arrow.color,
        master_only=arrow.master_only,
    )


async def card_responses(
    session: AsyncSession,
    cards: Sequence[MapCard],
    documents: Mapping[uuid.UUID, Document],
    viewer: Membership,
) -> list[CardResponse]:
    """Cards as returned, each Document card with its Document's name,
    subtitle, image and Tags, read in a fixed number of queries whatever the
    number of cards (the Documents list's batch functions). `cards` are
    already filtered for `viewer` and `documents` holds every Document they
    show. Shared with the mention maps (spec 36)."""
    shown_ids = [card.document_id for card in cards if card.document_id is not None]
    tags = await documents_repo.list_tag_ids_for_documents(session, shown_ids)
    images = await get_visible_images_for_documents(session, shown_ids, viewer)
    # A card shows the image chosen for it while its viewer still sees it,
    # else its Document's lead image (the favorite first); `image_id` only
    # echoes a choice they still see.
    card_images: dict[uuid.UUID, DocumentImage] = {}
    chosen_ids: dict[uuid.UUID, uuid.UUID] = {}
    for card in cards:
        if card.document_id is None:
            continue
        document_images = images.get(card.document_id, [])
        chosen = next((image for image in document_images if image.id == card.image_id), None)
        if chosen is not None:
            card_images[card.id] = chosen
            chosen_ids[card.id] = chosen.id
        elif document_images:
            card_images[card.id] = document_images[0]
    image_urls = await sign_images(card_images.values())

    def card_response(card: MapCard) -> CardResponse:
        """A card as returned, with its Document's look."""
        document = None
        if card.document_id is not None:
            shown_document = documents[card.document_id]
            image = card_images.get(card.id)
            signed = image_responses([image], image_urls) if image is not None else []
            document = MapDocumentResponse(
                id=shown_document.id,
                name=shown_document.name,
                subtitle=shown_document.subtitle,
                image=signed[0] if signed else None,
                tag_ids=tags[card.document_id],
            )
        return CardResponse(
            id=card.id,
            document_id=card.document_id,
            text=card.text,
            group_id=card.group_id,
            caption=card.caption,
            image_id=chosen_ids.get(card.id),
            size=card.size,
            master_only=card.master_only,
            color=card.color,
            struck=card.struck,
            x=card.x,
            y=card.y,
            document=document,
        )

    return [card_response(card) for card in cards]


async def _detail(
    session: AsyncSession,
    relationship_map: RelationshipMap,
    grants: Collection[uuid.UUID],
    viewer: Membership,
) -> MapDetailResponse:
    """The map and its board as `viewer` sees it (`card_responses`)."""
    board = (await relationship_maps_repo.get_boards(session, [relationship_map.id]))[
        relationship_map.id
    ]
    on_board = [card.document_id for card in board.cards if card.document_id is not None]
    documents = await documents_repo.get_documents_by_ids(session, on_board)
    visible = {
        document.id: document for document in await visible_documents(session, documents, viewer)
    }
    shown = visible_board(board, visible.keys(), viewer.role)
    shown_count = sum(1 for card in shown.cards if card.document_id is not None)
    summary = _summary(relationship_map, grants, viewer, shown_count)
    return MapDetailResponse(
        **summary.model_dump(),
        groups=[GroupBody(**vars(group)) for group in shown.groups],
        cards=await card_responses(session, shown.cards, visible, viewer),
        arrows=[arrow_body(arrow) for arrow in shown.arrows],
    )


async def create_free_map(
    session: AsyncSession,
    room_id: uuid.UUID,
    membership: Membership,
    name: str,
    board: BoardRequest | None,
    locale: str,
    *,
    description: str = "",
    visibility: DocumentVisibility | None = None,
    selective_user_ids: Collection[uuid.UUID] = (),
) -> MapDetailResponse:
    """Decision 2: a new map, a Player's only while the Room lets Players
    create Documents (403 otherwise); at most 100 per Room (409, Decision
    11). Without `visibility` it starts at the Room's default (VR-05). With
    `board`, it is filled through the board save's checks and caps (a mention
    map's copy, spec 36)."""
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    if not can_create_map(membership.role, room.players_can_create_documents):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.map.creationDisabled", locale)
    try:
        name, description = clean_map_fields(name, description)
    except (MapNameRequiredError, MapTextTooLongError) as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    starting = starting_visibility(room, visibility)
    grants = starting_grants(starting, selective_user_ids)
    await ensure_room_members(session, room_id, grants, "errors.map.invalidSelectiveUsers", locale)

    # The Room's lock makes count-then-insert safe against a concurrent
    # creation overshooting the cap.
    await rooms_repo.lock_room(session, room_id)
    try:
        ensure_room_for_another_map(
            await relationship_maps_repo.count_maps_for_room(session, room_id)
        )
    except TooManyMapsError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    now = _now()
    relationship_map = RelationshipMap(
        id=uuid.uuid4(),
        room_id=room_id,
        name=name,
        description=description,
        visibility=starting,
        created_by=membership.user_id,
        created_at=now,
        updated_at=now,
    )
    await relationship_maps_repo.insert_map(session, relationship_map, grants)
    if board is not None:
        await _apply_board(session, relationship_map.id, membership, board, locale)
    return await _detail(session, relationship_map, grants, membership)


@router.get("")
async def list_maps(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[MapResponse]:
    """Decision 1: the Room's maps the requester sees, last edited first,
    each with how many Documents it shows them, in a fixed number of
    queries."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    maps = await relationship_maps_repo.list_maps_for_room(session, room_id)
    grants = await relationship_maps_repo.list_grants_for_maps(session, [m.id for m in maps])
    visible = [
        m for m in maps if is_map_visible(m, membership.user_id, membership.role, grants[m.id])
    ]
    cards = await relationship_maps_repo.list_cards_for_maps(session, [m.id for m in visible])
    visible_ids = await _visible_document_ids(
        session,
        (
            card.document_id
            for map_cards in cards.values()
            for card in map_cards
            if card.document_id
        ),
        membership,
    )
    counts = document_card_counts(cards, visible_ids)
    return [_summary(m, grants[m.id], membership, counts.get(m.id, 0)) for m in visible]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_map(
    room_id: uuid.UUID,
    body: CreateMapRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """Decision 2: any member creates an empty map, a Player only while the
    Room lets Players create Documents (403 otherwise); at most 100 per Room
    (409, Decision 11)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    return await create_free_map(
        session,
        room_id,
        membership,
        body.name,
        None,
        locale,
        description=body.description,
        visibility=body.visibility,
        selective_user_ids=body.selective_user_ids,
    )


@router.get("/{map_id}")
async def get_map(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """The map and its board as the requester sees it (Decisions 4-7)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await _get_visible_map(session, room_id, map_id, membership, locale)
    return await _detail(session, relationship_map, grants, membership)


@router.patch("/{map_id}")
async def update_map(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    body: UpdateMapRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """Decisions 2 and 3: the map's creator or the Master renames it or
    changes who sees it. A change of level or grants is audited in the same
    transaction (Invariant 7)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await _get_managed_map(session, room_id, map_id, membership, locale)
    try:
        name, description = clean_map_fields(
            relationship_map.name if body.name is None else body.name,
            relationship_map.description if body.description is None else body.description,
        )
    except (MapNameRequiredError, MapTextTooLongError) as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    if body.selective_user_ids is not None:
        await ensure_room_members(
            session, room_id, body.selective_user_ids, "errors.map.invalidSelectiveUsers", locale
        )

    updated = replace(
        relationship_map,
        name=name,
        description=description,
        visibility=relationship_map.visibility if body.visibility is None else body.visibility,
        updated_at=_now(),
    )
    await relationship_maps_repo.update_map(session, updated)
    if body.selective_user_ids is not None:
        await relationship_maps_repo.set_map_grants(session, map_id, body.selective_user_ids)
    audit_entry = map_visibility_audit(
        relationship_map, updated, membership.user_id, grants, body.selective_user_ids
    )
    if audit_entry is not None:
        await rooms_repo.insert_audit_log(session, audit_entry)
    new_grants = grants if body.selective_user_ids is None else body.selective_user_ids
    return await _detail(session, updated, new_grants, membership)


@router.delete("/{map_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_map(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """Decision 2: the map's creator or the Master deletes it, with
    everything on it. The Documents themselves stay."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    await _get_managed_map(session, room_id, map_id, membership, locale)
    await relationship_maps_repo.delete_map(session, map_id)


def _arrow_end(end: ArrowEndBody) -> ArrowEnd:
    """A sent arrow end; 422 unless it names exactly one card or group."""
    if (end.card_id is None) == (end.group_id is None):
        raise InvalidBoardError("errors.map.invalidBoard")
    return ArrowEnd(card_id=end.card_id, group_id=end.group_id)


def _submitted_board(body: BoardRequest) -> Board:
    """The board as sent, in domain terms (not yet checked)."""
    return Board(
        groups=[MapGroup(**group.model_dump()) for group in body.groups],
        cards=[MapCard(**card.model_dump()) for card in body.cards],
        arrows=[
            MapArrow(
                id=arrow.id,
                from_end=_arrow_end(arrow.from_end),
                to_end=_arrow_end(arrow.to_end),
                direction=arrow.direction,
                label=arrow.label,
                reverse_label=arrow.reverse_label,
                label_position=arrow.label_position,
                reverse_label_position=arrow.reverse_label_position,
                label_offset=arrow.label_offset,
                reverse_label_offset=arrow.reverse_label_offset,
                color=arrow.color,
                master_only=arrow.master_only,
            )
            for arrow in body.arrows
        ],
    )


_BOARD_ERROR_STATUS: dict[type[DomainError], int] = {
    InvalidBoardError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    MapTextTooLongError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    BoardDocumentNotFoundError: status.HTTP_404_NOT_FOUND,
    BoardImageNotFoundError: status.HTTP_404_NOT_FOUND,
    MasterOnlyNotAllowedError: status.HTTP_403_FORBIDDEN,
    MapLimitError: status.HTTP_409_CONFLICT,
}


async def _apply_board(
    session: AsyncSession,
    map_id: uuid.UUID,
    membership: Membership,
    body: BoardRequest,
    locale: str,
) -> None:
    """Saves the board `membership` sends (`plan_board_edit`): what they see
    is created, moved, rewritten or removed, what they can't see stays. A
    card for a Document they don't see, or of another Room, is 404; an id of
    something hidden from them or of another map is 422; the caps (409)
    count every item on the map. Callers hold the map's lock."""
    current = (await relationship_maps_repo.get_boards(session, [map_id]))[map_id]
    try:
        submitted = _submitted_board(body)
        visible_ids = await _visible_document_ids(
            session,
            (
                card.document_id
                for card in [*current.cards, *submitted.cards]
                if card.document_id is not None
            ),
            membership,
        )
        sent_ids = (
            {group.id for group in submitted.groups}
            | {card.id for card in submitted.cards}
            | {arrow.id for arrow in submitted.arrows}
        )
        # Only a visible Document's images can be chosen.
        choosing = [
            card.document_id
            for card in submitted.cards
            if card.image_id is not None and card.document_id in visible_ids
        ]
        visible_images = await get_visible_images_for_documents(session, choosing, membership)
        plan = plan_board_edit(
            current,
            visible_board(current, visible_ids, membership.role),
            submitted,
            membership.role,
            visible_ids,
            await relationship_maps_repo.find_foreign_ids(session, map_id, sent_ids),
            {
                document_id: [image.id for image in images]
                for document_id, images in visible_images.items()
            },
        )
    except tuple(_BOARD_ERROR_STATUS) as exc:
        raise translated_error(_BOARD_ERROR_STATUS[type(exc)], exc, locale) from exc

    await relationship_maps_repo.save_board(session, map_id, plan)


@router.put("/{map_id}/board")
async def save_board(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    body: BoardRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """Decisions 9-12: saves the board the editor sees, in one transaction
    under the map's lock: creates, moves, rewrites and removes what they
    see, and leaves what they can't see exactly as it is. A card for a
    Document they don't see, or of another Room, is 404; an id of something
    hidden from them or of another map is 422; the caps (409) count every
    item on the map."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await _get_managed_map(session, room_id, map_id, membership, locale)
    await _apply_board(session, map_id, membership, body, locale)
    updated = replace(relationship_map, updated_at=_now())
    await relationship_maps_repo.update_map(session, updated)
    return await _detail(session, updated, grants, membership)


async def add_to_free_map(
    session: AsyncSession,
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    membership: Membership,
    additions: Callable[[Board], tuple[Sequence[MapCard], Sequence[MapArrow]]],
    locale: str,
) -> MapDetailResponse:
    """Adds `additions(board)` to a free map the requester manages (404 when
    hidden from them, 403 when they don't manage it), `board` being what they
    see of it: saved through the board save's checks and caps under the
    map's lock, as if they had drawn the new items by hand (a Document's
    mention graph, spec 36 Decision 15)."""
    relationship_map, grants = await _get_managed_map(session, room_id, map_id, membership, locale)
    shown = await _detail(session, relationship_map, grants, membership)
    current = BoardRequest(
        groups=shown.groups,
        cards=[CardBody(**card.model_dump(exclude={"document"})) for card in shown.cards],
        arrows=shown.arrows,
    )
    cards, arrows = additions(_submitted_board(current))
    board = BoardRequest(
        groups=current.groups,
        cards=[*current.cards, *(CardBody(**vars(card)) for card in cards)],
        arrows=[*current.arrows, *(arrow_body(arrow) for arrow in arrows)],
    )
    await _apply_board(session, map_id, membership, board, locale)
    updated = replace(relationship_map, updated_at=_now())
    await relationship_maps_repo.update_map(session, updated)
    return await _detail(session, updated, grants, membership)
