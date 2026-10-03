"""The Reveal action (spec 22, FR-V2, VR-06, UC-13): only the Master, only a
strict widening, and who counts as a recipient."""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.comments import plan_comment_deletion, plan_new_comment
from app.domain.models import ContentKind, DocumentVisibility, Membership, Reveal, RoomRole
from app.domain.reveal import (
    EffectiveSees,
    OnlyMasterRevealsError,
    RevealAudience,
    RevealAudienceRequiredError,
    RevealDeletedCommentError,
    RevealNotWideningError,
    RevealPlan,
    RevealTarget,
    content_id,
    ensure_can_reveal,
    ensure_comment_revealable,
    plan_reveal,
    revealed_level,
    unseen_reveals_once,
)
from app.domain.visibility import is_content_visible

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
ROOM_ID = uuid.uuid4()
DOCUMENT_ID = uuid.uuid4()
MASTER = uuid.uuid4()
OWNER = uuid.uuid4()
ALICE = uuid.uuid4()
BOB = uuid.uuid4()


def _member(user_id: uuid.UUID, role: RoomRole = RoomRole.PLAYER) -> Membership:
    return Membership(uuid.uuid4(), ROOM_ID, user_id, role, is_admin=role == RoomRole.MASTER)


MEMBERS = [_member(MASTER, RoomRole.MASTER), _member(OWNER), _member(ALICE), _member(BOB)]
DOCUMENT = RevealTarget(ContentKind.DOCUMENT, DOCUMENT_ID, owner_ids=frozenset({OWNER}))


def _own(member: Membership, visibility: DocumentVisibility, grants: Collection[uuid.UUID]) -> bool:
    return is_content_visible(visibility, member.user_id, member.role, {OWNER}, grants)


def _reveal(
    visibility: DocumentVisibility,
    audience: RevealAudience,
    grants: Collection[uuid.UUID] = (),
    target: RevealTarget = DOCUMENT,
    sees: EffectiveSees = _own,
) -> RevealPlan:
    return plan_reveal(target, visibility, grants, audience, MEMBERS, sees, ROOM_ID, MASTER, NOW)


def test_only_the_master_reveals() -> None:
    ensure_can_reveal(RoomRole.MASTER)
    with pytest.raises(OnlyMasterRevealsError):
        ensure_can_reveal(RoomRole.PLAYER)


@pytest.mark.parametrize(
    ("visibility", "grants", "audience", "expected"),
    [
        (DocumentVisibility.MASTER, (), RevealAudience(True), (DocumentVisibility.ROOM, set())),
        (
            DocumentVisibility.MASTER,
            (),
            RevealAudience(False, frozenset({ALICE})),
            (DocumentVisibility.SELECTIVE, {ALICE}),
        ),
        (
            DocumentVisibility.PRIVATE,
            (),
            RevealAudience(False, frozenset({ALICE})),
            (DocumentVisibility.SELECTIVE, {ALICE}),
        ),
        (
            DocumentVisibility.SELECTIVE,
            (BOB,),
            RevealAudience(False, frozenset({ALICE})),
            (DocumentVisibility.SELECTIVE, {ALICE, BOB}),
        ),
        (
            DocumentVisibility.ROOM,
            (),
            RevealAudience(False, frozenset({ALICE})),
            (DocumentVisibility.ROOM, set()),
        ),
    ],
)
def test_revealed_level_only_widens(
    visibility: DocumentVisibility,
    grants: tuple[uuid.UUID, ...],
    audience: RevealAudience,
    expected: tuple[DocumentVisibility, set[uuid.UUID]],
) -> None:
    level, new_grants = revealed_level(visibility, grants, audience)
    assert (level, set(new_grants)) == expected


def test_revealing_a_master_only_document_to_the_room_tells_every_player() -> None:
    plan = _reveal(DocumentVisibility.MASTER, RevealAudience(True))

    assert plan.visibility == DocumentVisibility.ROOM
    assert plan.recipients == {OWNER, ALICE, BOB}
    assert plan.reveal.kind == ContentKind.DOCUMENT
    assert plan.reveal.revealed_by == MASTER
    entry = plan.audit_entry
    assert entry.action == "document_revealed"
    assert entry.details["from"] == "master"
    assert entry.details["to"] == "room"
    assert entry.details["reveal_id"] == str(plan.reveal.id)
    assert entry.details["recipient_ids"] == sorted(str(u) for u in (OWNER, ALICE, BOB))
    assert "note_id" not in entry.details and "comment_id" not in entry.details


def test_recipients_leave_out_who_already_saw_it() -> None:
    plan = _reveal(DocumentVisibility.SELECTIVE, RevealAudience(True), grants=(ALICE,))
    # The Owner and Alice saw it already, the Master always does.
    assert plan.recipients == {BOB}


def test_revealing_to_chosen_players_adds_them_only() -> None:
    plan = _reveal(DocumentVisibility.PRIVATE, RevealAudience(False, frozenset({ALICE})))
    assert plan.visibility == DocumentVisibility.SELECTIVE
    assert plan.selective_user_ids == {ALICE}
    assert plan.recipients == {ALICE}


def test_a_master_only_document_revealed_to_one_player_reaches_its_owners_too() -> None:
    # Selective includes the Owners, so they gain it as well; the dialog says so.
    plan = _reveal(DocumentVisibility.MASTER, RevealAudience(False, frozenset({ALICE})))
    assert plan.recipients == {ALICE, OWNER}


def test_a_reveal_that_widens_nothing_is_refused() -> None:
    with pytest.raises(RevealNotWideningError):
        _reveal(DocumentVisibility.ROOM, RevealAudience(True))
    with pytest.raises(RevealNotWideningError):
        # Alice is already granted, the Owner already sees it.
        _reveal(
            DocumentVisibility.SELECTIVE,
            RevealAudience(False, frozenset({ALICE, OWNER})),
            grants=(ALICE,),
        )


def test_a_reveal_needs_an_audience() -> None:
    with pytest.raises(RevealAudienceRequiredError):
        _reveal(DocumentVisibility.MASTER, RevealAudience(False))


def test_recipients_follow_the_effective_visibility() -> None:
    # A Note on a Document only Alice sees: revealing it to the Room tells
    # Alice alone, since nobody else reaches the Document.
    note = RevealTarget(
        ContentKind.NOTE, DOCUMENT_ID, note_id=uuid.uuid4(), owner_ids=frozenset({OWNER})
    )

    def sees(
        member: Membership, visibility: DocumentVisibility, grants: Collection[uuid.UUID]
    ) -> bool:
        return member.user_id in (MASTER, ALICE) and _own(member, visibility, grants)

    plan = _reveal(DocumentVisibility.MASTER, RevealAudience(True), target=note, sees=sees)
    assert plan.recipients == {ALICE}
    assert plan.audit_entry.action == "note_revealed"
    assert plan.audit_entry.details["note_id"] == str(note.note_id)


def test_a_comment_author_is_never_a_recipient() -> None:
    comment = RevealTarget(
        ContentKind.COMMENT,
        DOCUMENT_ID,
        comment_id=uuid.uuid4(),
        author_id=ALICE,
        owner_ids=frozenset({ALICE}),
        always_visible_to=frozenset({ALICE}),
    )

    def sees(
        member: Membership, visibility: DocumentVisibility, grants: Collection[uuid.UUID]
    ) -> bool:
        return member.user_id == ALICE or is_content_visible(
            visibility, member.user_id, member.role, {ALICE}, grants
        )

    plan = _reveal(DocumentVisibility.MASTER, RevealAudience(True), target=comment, sees=sees)
    assert plan.recipients == {OWNER, BOB}
    assert plan.audit_entry.action == "comment_revealed"
    assert plan.audit_entry.target_user_id == ALICE
    assert plan.audit_entry.details["comment_id"] == str(comment.comment_id)

    # Revealing it to its own author alone widens nothing.
    with pytest.raises(RevealNotWideningError):
        _reveal(
            DocumentVisibility.MASTER,
            RevealAudience(False, frozenset({ALICE})),
            target=comment,
            sees=sees,
        )


def test_a_deleted_comment_cant_be_revealed() -> None:
    comment = plan_new_comment(DOCUMENT_ID, ALICE, "Hi", DocumentVisibility.MASTER, NOW)
    ensure_comment_revealable(comment)
    deleted = plan_comment_deletion(comment, ALICE, RoomRole.PLAYER, NOW)
    with pytest.raises(RevealDeletedCommentError):
        ensure_comment_revealable(deleted)


def _stored(kind: ContentKind, at: datetime, **ids: uuid.UUID) -> Reveal:
    return Reveal(
        id=uuid.uuid4(),
        room_id=ROOM_ID,
        kind=kind,
        document_id=DOCUMENT_ID,
        note_id=ids.get("note_id"),
        comment_id=ids.get("comment_id"),
        revealed_by=MASTER,
        revealed_at=at,
    )


def test_content_revealed_twice_counts_once() -> None:
    note_id = uuid.uuid4()
    first = _stored(ContentKind.DOCUMENT, NOW)
    again = _stored(ContentKind.DOCUMENT, NOW + timedelta(hours=1))
    older_again = _stored(ContentKind.DOCUMENT, NOW - timedelta(hours=1))
    note = _stored(ContentKind.NOTE, NOW + timedelta(minutes=5), note_id=note_id)

    assert unseen_reveals_once([first, again, older_again, note]) == [again, note]
    assert content_id(note) == note_id
    assert content_id(first) == DOCUMENT_ID
