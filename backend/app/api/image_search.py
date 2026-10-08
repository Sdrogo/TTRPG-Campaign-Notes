"""Image search for a Document (spec 29): free images from Openverse that an
Owner or the Master can add to the Document. Picking a result goes through
the existing `POST .../images/from-url`, so nothing found here is stored or
trusted (Decision 4); this route only searches."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel

from app.api.access import get_owned_document
from app.api.errors import translated_error
from app.auth.dependencies import CurrentUserDep
from app.db import openverse
from app.db.session import SessionDep
from app.domain.image_search import (
    MAX_PAGE,
    MAX_QUERY_LENGTH,
    ImageResult,
    ImageSearchError,
    Throttle,
    normalize_query,
    parse_page,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["image-search"])

# One per process, shared by every request (Decision 6).
throttle = Throttle()


class ImageResultResponse(BaseModel):
    """One image: its thumbnail (always on Openverse), the full image to
    import, and the credit the picker shows."""

    id: uuid.UUID
    thumbnail_url: str
    url: str
    width: int | None
    height: int | None
    title: str | None
    creator: str | None
    license: str | None
    license_url: str | None
    source_url: str | None


class ImageSearchResponse(BaseModel):
    """A page of results and whether a next page can be asked for."""

    results: list[ImageResultResponse]
    page: int
    has_more: bool


def _shown(result: ImageResult) -> ImageResultResponse:
    """The API form of an `ImageResult`."""
    return ImageResultResponse(
        id=result.id,
        thumbnail_url=result.thumbnail_url,
        url=result.url,
        width=result.width,
        height=result.height,
        title=result.title,
        creator=result.creator,
        license=result.license,
        license_url=result.license_url,
        source_url=result.source_url,
    )


@router.get("/rooms/{room_id}/documents/{document_id}/image-search")
async def search_images(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    q: Annotated[str, Query(max_length=MAX_QUERY_LENGTH)] = "",
    page: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 1,
) -> ImageSearchResponse:
    """Searches Openverse for `q` on behalf of whoever may add images to the
    Document: 404 when the requester can't see it, 403 when they are neither
    an Owner nor the Master (Decision 2). 422 for an empty query, 429 past
    the per-user throttle, 502 when Openverse fails or throttles us."""
    requester_id = uuid.UUID(current_user.id)
    await get_owned_document(session, room_id, document_id, requester_id, locale)
    try:
        query = normalize_query(q)
    except ImageSearchError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    try:
        throttle.check(requester_id)
    except ImageSearchError as exc:
        raise translated_error(status.HTTP_429_TOO_MANY_REQUESTS, exc, locale) from exc
    try:
        raw = await openverse.search_images(query, page)
    except ImageSearchError as exc:
        raise translated_error(status.HTTP_502_BAD_GATEWAY, exc, locale) from exc
    result_page = parse_page(raw, page)
    return ImageSearchResponse(
        results=[_shown(r) for r in result_page.results],
        page=result_page.page,
        has_more=result_page.has_more,
    )
