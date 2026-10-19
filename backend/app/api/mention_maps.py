"""Mention maps (spec 36): a Document's live relationship map, computed from
the mentions the requester sees every time it is read (Decision 1). Members
only (403); a Document the requester can't see is 404, as for the Document
itself (VR-07). Reads follow `X-View-As`, which refuses every write."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_document, require_membership, visible_documents
from app.api.errors import http_error, translated_error
from app.api.mentions import visible_mentions
from app.api.relationship_maps import (
    ArrowBody,
    ArrowEndBody,
    BoardRequest,
    CardBody,
    CardResponse,
    MapDetailResponse,
    arrow_body,
    card_responses,
    create_free_map,
    ensure_manages_map,
    visible_map_detail,
)
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, mentions_repo, relationship_maps_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.mention_maps import (
    MAX_MENTION_DEPTH,
    MentionDepthError,
    MentionGraph,
    NothingToMapError,
    ensure_depth,
    ensure_something_to_map,
    mention_board,
    mention_card_id,
    mention_graph,
    next_ring,
)
from app.domain.models import Document, DocumentMention, DocumentVisibility, Membership
from app.domain.relationship_maps import (
    MAX_COORDINATE,
    BoardPlan,
    CardSize,
    MapCard,
    MapColor,
    RelationshipMap,
    can_create_map,
    can_manage_map,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/documents/{document_id}/mention-map", tags=["maps"])
linked_router = APIRouter(
    prefix="/rooms/{room_id}/documents/{document_id}/linked-map", tags=["maps"]
)


class MentionMapResponse(BaseModel):
    """A Document's mention map as the requester sees it: its depth, the
    cards and relations computed from the mentions they see (spec 36
    Decision 7), and how many Documents the 150-card cap left out.
    `can_manage` says whether they may change the depth, move or recolor
    cards, delete it or copy it."""

    id: uuid.UUID
    document_id: uuid.UUID
    depth: int
    created_by: uuid.UUID
    updated_at: datetime
    can_manage: bool
    cards: list[CardResponse]
    arrows: list[ArrowBody]
    documents_left_out: int


class MentionMapPreviewResponse(BaseModel):
    """What a mention map at a depth would hold for the requester (Decision
    11): the other Documents, the relations and the Documents the cap would
    leave out."""

    documents: int
    relations: int
    documents_left_out: int


class MentionMapDepthRequest(BaseModel):
    """The depth to create or change a mention map with (Decision 2)."""

    depth: int = Field(default=0, ge=0, le=MAX_MENTION_DEPTH)


class MentionCardBody(BaseModel):
    """A card a manager moved or recolored: its Document, place and color."""

    document_id: uuid.UUID
    x: float = Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE)
    y: float = Field(ge=-MAX_COORDINATE, le=MAX_COORDINATE)
    color: MapColor = MapColor.DEFAULT


class MentionCardsRequest(BaseModel):
    """The cards to save; the others keep their place and color."""

    cards: list[MentionCardBody]


class CopyMentionMapRequest(BaseModel):
    """The name of the free map the copy becomes."""

    name: str


class LinkMapRequest(BaseModel):
    """The free map to show on the Document's page (Decision 15)."""

    map_id: uuid.UUID


async def _visible_links(
    session: AsyncSession, mentions: list[DocumentMention], viewer: Membership
) -> tuple[list[tuple[uuid.UUID, uuid.UUID]], dict[uuid.UUID, Document]]:
    """One `(source, target)` link per mention `viewer` sees: its source place
    (`visible_mentions`, the "Mentioned in" rule) and its target Document
    (Decision 7), with every Document read on the way."""
    visible = await visible_mentions(session, mentions, viewer)
    targets = await documents_repo.get_documents_by_ids(
        session,
        list({m.target_document_id for m in visible.mentions if m.target_document_id is not None}),
    )
    seen = {document.id: document for document in await visible_documents(session, targets, viewer)}
    links = [
        (mention.source_document_id, mention.target_document_id)
        for mention in visible.mentions
        if mention.target_document_id in seen
    ]
    return links, {**visible.documents, **seen}


async def _graph(
    session: AsyncSession, center: Document, depth: int, viewer: Membership
) -> tuple[MentionGraph, dict[uuid.UUID, Document]]:
    """The map around `center` for `viewer` (Decisions 2 to 5, 7, 10): one
    query round per ring, only through the mentions they see, so a Document
    reachable only through a hidden mention never shows. The last round
    reads the outer ring's own mentions, for the relations among its
    cards."""
    documents = {center.id: center}
    links: list[tuple[uuid.UUID, uuid.UUID]] = []
    fetched: set[uuid.UUID] = set()
    known = {center.id}
    frontier = {center.id}
    for _ in range(depth + 2):
        found = await mentions_repo.list_document_mentions_touching(session, frontier)
        fresh = [mention for mention in found if mention.id not in fetched]
        fetched.update(mention.id for mention in fresh)
        step_links, step_documents = await _visible_links(session, fresh, viewer)
        links.extend(step_links)
        documents.update(step_documents)
        frontier = next_ring(frontier, links, known)
        if not frontier:
            break
        known.update(frontier)
    names = {document_id: document.name for document_id, document in documents.items()}
    return mention_graph(center.id, depth, links, names), documents


async def _response(
    session: AsyncSession, mention_map: RelationshipMap, center: Document, viewer: Membership
) -> MentionMapResponse:
    """The mention map as `viewer` sees it, with the saved places and colors
    of the cards someone moved or recolored."""
    depth = mention_map.mention_depth or 0
    graph, documents = await _graph(session, center, depth, viewer)
    saved = (await relationship_maps_repo.get_boards(session, [mention_map.id]))[mention_map.id]
    names = {document_id: document.name for document_id, document in documents.items()}
    cards, arrows = mention_board(mention_map.id, graph, names, saved.cards)
    return MentionMapResponse(
        id=mention_map.id,
        document_id=center.id,
        depth=depth,
        created_by=mention_map.created_by,
        updated_at=mention_map.updated_at,
        can_manage=can_manage_map(mention_map, viewer.user_id, viewer.role),
        cards=await card_responses(session, cards, documents, viewer),
        arrows=[arrow_body(arrow) for arrow in arrows],
        documents_left_out=graph.left_out,
    )


async def _center(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    locale: str,
) -> tuple[Membership, Document]:
    """The requester's Membership and the Document, once they are a member
    (403) who sees it (404)."""
    membership = await require_membership(session, room_id, user_id, locale)
    document, _, _ = await get_visible_document(
        session, room_id, document_id, user_id, membership.role, locale
    )
    return membership, document


async def _get_map(session: AsyncSession, document_id: uuid.UUID, locale: str) -> RelationshipMap:
    """The Document's mention map, or 404 when it has none."""
    mention_map = await relationship_maps_repo.get_mention_map(session, document_id)
    if mention_map is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.mentionMap.notFound", locale)
    return mention_map


async def _get_managed_map(
    session: AsyncSession, document_id: uuid.UUID, viewer: Membership, locale: str
) -> RelationshipMap:
    """`_get_map`, then 403 unless the viewer is its creator or the Master
    (Decision 9), re-read under the map's row lock so changes serialize."""
    mention_map = await _get_map(session, document_id, locale)
    if not can_manage_map(mention_map, viewer.user_id, viewer.role):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.map.notManager", locale)
    locked = await relationship_maps_repo.lock_map(session, mention_map.id)
    if locked is None:  # pragma: no cover - only a concurrent deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.mentionMap.notFound", locale)
    return locked


def _card_end(end: ArrowEndBody) -> uuid.UUID:
    """The card a mention map's relation ends on: always a card there."""
    assert end.card_id is not None
    return end.card_id


def _now() -> datetime:
    """The current time, in UTC."""
    return datetime.now(UTC)


@router.get("")
async def get_mention_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MentionMapResponse:
    """The Document's mention map as the requester sees it (Decisions 7, 8):
    whoever sees the Document sees it, with only the Documents and relations
    behind mentions they see. 404 when the Document has none."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    mention_map = await _get_map(session, document_id, locale)
    return await _response(session, mention_map, center, membership)


@router.get("/preview")
async def preview_mention_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    depth: int = 0,
) -> MentionMapPreviewResponse:
    """Decision 11: what a mention map at `depth` would hold for the
    requester, computed exactly as the map is (one source of truth). 422 for
    a depth outside 0 to 3."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    try:
        ensure_depth(depth)
    except MentionDepthError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    graph, _ = await _graph(session, center, depth, membership)
    return MentionMapPreviewResponse(
        documents=len(graph.cards) - 1,
        relations=len(graph.relations),
        documents_left_out=graph.left_out,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_mention_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: MentionMapDepthRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MentionMapResponse:
    """Decisions 1, 2, 9, 11: whoever may create maps (spec 28 Decision 2)
    and sees the Document generates its mention map (403 otherwise). 409
    when it already has one, and 409 with nothing created when the requester
    sees no mention to draw. Mention maps don't count towards the Room's
    100 maps."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    if not can_create_map(membership.role, room.players_can_create_documents):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.map.creationDisabled", locale)
    graph, _ = await _graph(session, center, body.depth, membership)
    try:
        ensure_something_to_map(graph)
    except NothingToMapError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    # The Room's lock makes check-then-insert safe against a concurrent
    # creation for the same Document.
    await rooms_repo.lock_room(session, room_id)
    if await relationship_maps_repo.get_mention_map(session, document_id) is not None:
        raise http_error(status.HTTP_409_CONFLICT, "errors.mentionMap.alreadyExists", locale)
    now = _now()
    mention_map = RelationshipMap(
        id=uuid.uuid4(),
        room_id=room_id,
        name=center.name[:100],
        description="",
        # Unused: a mention map is seen by whoever sees its Document.
        visibility=DocumentVisibility.ROOM,
        created_by=membership.user_id,
        created_at=now,
        updated_at=now,
        source_document_id=center.id,
        mention_depth=body.depth,
    )
    await relationship_maps_repo.insert_map(session, mention_map, [])
    return await _response(session, mention_map, center, membership)


@router.patch("")
async def update_mention_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: MentionMapDepthRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MentionMapResponse:
    """Decision 2: the map's creator or the Master changes its depth."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    mention_map = await _get_managed_map(session, document_id, membership, locale)
    updated = RelationshipMap(
        **{**vars(mention_map), "mention_depth": body.depth, "updated_at": _now()}
    )
    await relationship_maps_repo.update_map(session, updated)
    return await _response(session, updated, center, membership)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mention_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """Decision 9: the map's creator or the Master deletes it. The Documents
    and their mentions stay."""
    membership, _ = await _center(session, room_id, document_id, uuid.UUID(current_user.id), locale)
    mention_map = await _get_managed_map(session, document_id, membership, locale)
    await relationship_maps_repo.delete_map(session, mention_map.id)


@router.put("/cards")
async def save_mention_cards(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: MentionCardsRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MentionMapResponse:
    """Decision 9: the map's creator or the Master moves or recolors cards,
    saved for everyone. Only a card on the map as they see it (404 for any
    other Document). A saved card stays when its Document leaves the map,
    so it comes back in place if the mention does."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    mention_map = await _get_managed_map(session, document_id, membership, locale)
    graph, _ = await _graph(session, center, mention_map.mention_depth or 0, membership)
    on_map = {card.document_id for card in graph.cards}
    if any(card.document_id not in on_map for card in body.cards):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.document.notFound", locale)
    cards = [
        MapCard(
            id=mention_card_id(mention_map.id, card.document_id),
            document_id=card.document_id,
            text=None,
            group_id=None,
            caption=None,
            size=CardSize.NORMAL,
            master_only=False,
            color=card.color,
            struck=False,
            x=card.x,
            y=card.y,
        )
        for card in {card.document_id: card for card in body.cards}.values()
    ]
    await relationship_maps_repo.save_board(
        session, mention_map.id, BoardPlan(groups=[], cards=cards, arrows=[])
    )
    updated = RelationshipMap(**{**vars(mention_map), "updated_at": _now()})
    await relationship_maps_repo.update_map(session, updated)
    return await _response(session, updated, center, membership)


@router.post("/copy", status_code=status.HTTP_201_CREATED)
async def copy_mention_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: CopyMentionMapRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """Decision 9: the map's creator or the Master saves what they see of it
    as an ordinary free map (spec 28) they can edit by hand, at the Room's
    default visibility, through the same checks and caps as any new map."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    mention_map = await _get_managed_map(session, document_id, membership, locale)
    shown = await _response(session, mention_map, center, membership)
    new_ids = {card.id: uuid.uuid4() for card in shown.cards}
    board = BoardRequest(
        cards=[
            CardBody(
                id=new_ids[card.id],
                document_id=card.document_id,
                color=card.color,
                x=card.x,
                y=card.y,
            )
            for card in shown.cards
        ],
        arrows=[
            ArrowBody(
                id=uuid.uuid4(),
                from_end=ArrowEndBody(card_id=new_ids[_card_end(arrow.from_end)]),
                to_end=ArrowEndBody(card_id=new_ids[_card_end(arrow.to_end)]),
                direction=arrow.direction,
            )
            for arrow in shown.arrows
        ],
    )
    return await create_free_map(session, room_id, membership, body.name, board, locale)


async def _linked_map_id(session: AsyncSession, document_id: uuid.UUID, locale: str) -> uuid.UUID:
    """The free map linked to the Document, or 404 when it has none."""
    map_id = await relationship_maps_repo.get_linked_map_id(session, document_id)
    if map_id is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.map.notFound", locale)
    return map_id


@linked_router.get("")
async def get_linked_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """Decision 15: the map linked to the Document, as the requester
    sees it, for its page. 404 when the Document has none, or when the map is
    hidden from them (then it is simply not shown)."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    map_id = await _linked_map_id(session, center.id, locale)
    return await visible_map_detail(session, room_id, map_id, membership, locale)


@linked_router.put("")
async def link_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: LinkMapRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MapDetailResponse:
    """Decision 15: shows a map of the Room the requester manages on the
    Document's page, exactly as it is: nothing is added to or changed on the
    map. A free map (spec 28) comes with its board; a geographic one (spec
    38 Decision 1) with `kind`, and the page reads its content from
    `.../maps/{map_id}/geo`. 404 when the map is hidden from them, 403 when
    they don't manage it. It replaces any map linked before, which only
    whoever manages that map may do (403, or 404 when it is hidden from
    them, so the link doesn't leak, VR-07)."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    await ensure_manages_map(session, room_id, body.map_id, membership, locale)
    linked_id = await relationship_maps_repo.get_linked_map_id(session, center.id)
    if linked_id is not None and linked_id != body.map_id:
        await ensure_manages_map(session, room_id, linked_id, membership, locale)
    await relationship_maps_repo.link_map(
        session, center.id, body.map_id, membership.user_id, _now()
    )
    return await visible_map_detail(session, room_id, body.map_id, membership, locale)


@linked_router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_map(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """Decision 15: whoever manages the linked map (its creator and the
    Master) takes it off the Document's page. The map and its cards stay."""
    membership, center = await _center(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    map_id = await _linked_map_id(session, center.id, locale)
    await ensure_manages_map(session, room_id, map_id, membership, locale)
    await relationship_maps_repo.unlink_map(session, center.id)
