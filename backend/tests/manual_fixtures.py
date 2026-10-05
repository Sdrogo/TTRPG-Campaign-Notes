"""A small Room as an export tree, shared by the manual's layout tests and the
PDF rendering tests (spec 23b). Plain data, no database."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.domain.export import (
    Export,
    ExportComment,
    ExportDocument,
    ExportImage,
    ExportMember,
    ExportNote,
    ExportTag,
    MentionSpan,
    Span,
    TextSpan,
)
from app.domain.manual import ManualLabels
from app.domain.mentions import MentionKind
from app.domain.models import DocumentVisibility


def uid(n: int) -> uuid.UUID:
    """A readable, stable id."""
    return uuid.UUID(int=n)


T0 = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)
MARA, ALICE, BOB = uid(10), uid(11), uid(12)
NPC, PLACE, EMPTY_TAG = uid(20), uid(21), uid(22)
CASTLE, IRENA, ORPHAN, GONE = uid(30), uid(31), uid(32), uid(33)

LABELS = ManualLabels(
    contents="Contents",
    index="Index",
    other="Other",
    documents="Documents",
    comments="Comments",
    unknown_member="Unknown member",
    deleted_comment="(deleted)",
    played_by="{character} (played by {player})",
    page_abbreviation="p.",
)


def text(value: str) -> TextSpan:
    """A plain span."""
    return TextSpan(value)


def mention(kind: MentionKind, target: uuid.UUID, name: str) -> MentionSpan:
    """A mention span."""
    return MentionSpan(kind, target, name)


def note(n: int, title: str, *spans: Span) -> ExportNote:
    """A Note at Room level."""
    return ExportNote(uid(100 + n), title, spans, n, DocumentVisibility.ROOM, None)


def comment(
    n: int,
    author: uuid.UUID,
    body: str,
    parent: int | None = None,
    deleted: bool = False,
    as_character: uuid.UUID | None = None,
) -> ExportComment:
    """A Comment at Room level, written `n` minutes after `T0`."""
    when = T0 + timedelta(minutes=n)
    return ExportComment(
        id=uid(200 + n),
        parent_id=None if parent is None else uid(200 + parent),
        author_id=author,
        as_character_id=as_character,
        body=() if deleted else (TextSpan(body),),
        created_at=when,
        updated_at=when,
        deleted=deleted,
        visibility=DocumentVisibility.ROOM,
        selective_user_ids=None,
        images=(),
    )


def document(
    doc_id: uuid.UUID, name: str, tags: tuple[uuid.UUID, ...] = (), **fields: Any
) -> ExportDocument:
    """A Document with nothing on it unless `fields` say so."""
    values: dict[str, Any] = {
        "id": doc_id,
        "name": name,
        "description": (),
        "visibility": DocumentVisibility.ROOM,
        "selective_user_ids": None,
        "tag_ids": tags,
        "owner_ids": (),
        "played_by": None,
        "images": (),
        "files": (),
        "notes": (),
        "comments": (),
    }
    values.update(fields)
    return ExportDocument(**values)


def image(n: int, favorite: bool = False) -> ExportImage:
    """An image with a signed-looking link."""
    return ExportImage(uid(300 + n), f"https://storage.example/img/{n}.webp?token=t{n}", favorite)


def make_export(**overrides: Any) -> Export:
    """Chapters NPC (Castle, Irena), Place (Castle again) and Other (Orphan),
    with Castle's description mentioning Irena, a Document the PDF doesn't
    hold, a Tag and a member."""
    castle = document(
        CASTLE,
        "Castle",
        (PLACE, NPC),
        description=(
            text("Ruled by "),
            mention(MentionKind.DOCUMENT, IRENA, "Irena"),
            text(".\n\nSecond paragraph, near "),
            mention(MentionKind.DOCUMENT, GONE, "Gone"),
            text(", for "),
            mention(MentionKind.TAG, NPC, "NPC"),
            text(" and "),
            mention(MentionKind.USER, ALICE, "Alice"),
            text("."),
        ),
        notes=(note(1, "Read aloud", text("The gates creak.")),),
        images=(image(1), image(2, favorite=True)),
    )
    documents = [
        castle,
        document(IRENA, "Irena", (NPC,), description=(text("A vampire."),)),
        document(ORPHAN, "Orphan"),
    ]
    values: dict[str, Any] = {
        "room_id": uid(1),
        "room_name": "Barovia",
        "game_system": "D&D 5e",
        "generated_at": T0,
        "link_ttl_seconds": 3600,
        "members": [
            ExportMember(MARA, "Mara"),
            ExportMember(ALICE, "Alice"),
            ExportMember(BOB, None),
        ],
        "tags": [
            ExportTag(EMPTY_TAG, "Empty", None),
            ExportTag(NPC, "NPC", "Type"),
            ExportTag(PLACE, "Place", None),
        ],
        "main_items": [(NPC,), (PLACE,)],
        "tag_filter": [],
        "documents": documents,
        "visible_documents": {d.id: d.name for d in documents} | {GONE: "Gone"},
    }
    values.update(overrides)
    return Export(**values)
