"""Document and Tag mentions (spec 20): cleaning, backlink rows with their
excerpts, and the one-off conversion of plain `#Name` text."""

import uuid
from datetime import UTC, datetime, timedelta

from app.domain.mentions import (
    MentionKind,
    NamedTarget,
    PlannedMention,
    content_targets,
    convert_plain_mentions,
    display_text,
    find_mentions,
    mention_excerpt,
    mention_token,
    plain_mentions,
    plan_source_mentions,
    unlink_unknown_content,
)

ALICE = uuid.UUID("11111111-1111-4111-8111-111111111111")
DOC = uuid.UUID("33333333-3333-4333-8333-333333333333")
OTHER = uuid.UUID("44444444-4444-4444-8444-444444444444")
TAG = uuid.UUID("55555555-5555-4555-8555-555555555555")
SOURCE = uuid.UUID("66666666-6666-4666-8666-666666666666")
T0 = datetime(2026, 1, 1, tzinfo=UTC)


def test_unknown_documents_and_tags_become_plain_text() -> None:
    text = (
        f"#[Castle](doc:{DOC}) #[Gone](doc:{OTHER}) #[NPC](tag:{TAG}) "
        f"#[Old](tag:{OTHER}) @[Alice](user:{ALICE})"
    )

    assert unlink_unknown_content(text, {DOC}, {TAG}) == (
        f"#[Castle](doc:{DOC}) #Gone #[NPC](tag:{TAG}) #Old @[Alice](user:{ALICE})"
    )


def test_plain_mentions_keeps_only_member_tokens() -> None:
    text = f"#[Castle](doc:{DOC}), #[NPC](tag:{TAG}) and @[Alice](user:{ALICE})"

    assert plain_mentions(text) == f"#Castle, #NPC and @[Alice](user:{ALICE})"


def test_content_targets_splits_documents_and_tags() -> None:
    text = f"#[A](doc:{DOC}) #[B](doc:{OTHER}) #[T](tag:{TAG}) @[Alice](user:{ALICE})"

    assert content_targets(text) == ({DOC, OTHER}, {TAG})


def test_a_token_escapes_its_name_and_reads_back() -> None:
    token = mention_token(MentionKind.DOCUMENT, DOC, "The ] \\ Gate")

    assert token == f"#[The \\] \\\\ Gate](doc:{DOC})"
    assert find_mentions(token)[0].name == "The ] \\ Gate"


def test_display_text_shows_names() -> None:
    assert display_text(f"See #[Castle](doc:{DOC}) with @[Alice](user:{ALICE})") == (
        "See #Castle with @Alice"
    )


def test_one_row_per_target_skipping_people_and_the_document_itself() -> None:
    text = (
        f"#[Castle](doc:{DOC}) again #[Castle](doc:{DOC}), #[NPC](tag:{TAG}), "
        f"@[Alice](user:{ALICE}) and myself #[Me](doc:{SOURCE})"
    )

    planned = plan_source_mentions(text, SOURCE)

    assert [(p.target_document_id, p.target_tag_id) for p in planned] == [
        (DOC, None),
        (None, TAG),
    ]
    assert planned[0] == PlannedMention(DOC, None, display_text(text))


def test_a_short_text_is_its_own_excerpt_with_spaces_collapsed() -> None:
    text = f"Go to\n\n  #[Castle](doc:{DOC})   tonight."

    assert mention_excerpt(text, find_mentions(text)[0]) == "Go to #Castle tonight."


def test_a_long_text_is_cut_on_words_around_the_mention() -> None:
    before = " ".join(f"before{i}" for i in range(30))
    after = " ".join(f"after{i}" for i in range(30))
    text = f"{before} #[Castle](doc:{DOC}) {after}"

    excerpt = mention_excerpt(text, find_mentions(text)[0], length=40)

    assert excerpt == "… before29 #Castle after0 after1…"


def test_room_one_side_does_not_use_goes_to_the_other() -> None:
    after = " ".join(f"after{i}" for i in range(30))
    text = f"Hi #[Castle](doc:{DOC}) {after}"

    excerpt = mention_excerpt(text, find_mentions(text)[0], length=40)

    assert excerpt == "Hi #Castle after0 after1 after2 after3…"


def test_a_cut_inside_one_long_word_keeps_only_the_ellipsis() -> None:
    text = f"{'x' * 50}#[C](doc:{DOC}) {'y' * 50}"
    mention = find_mentions(text)[0]

    assert mention_excerpt(text, mention, length=10) == "…#C…"


def _doc(name: str, target_id: uuid.UUID, age: int = 0) -> NamedTarget:
    return NamedTarget(target_id, name, T0 + timedelta(days=age))


def test_converts_plain_mentions_by_the_browser_rule() -> None:
    documents = [_doc("Castle", DOC), _doc("Castle Ravenloft", OTHER)]
    tags = [_doc("NPC", TAG)]
    text = "(#castle ravenloft) then #Castle, #npc and #Castles #nothing a#Castle"

    assert convert_plain_mentions(text, documents, tags) == (
        f"(#[castle ravenloft](doc:{OTHER})) then #[Castle](doc:{DOC}), "
        f"#[npc](tag:{TAG}) and #Castles #nothing a#Castle"
    )


def test_a_document_beats_a_tag_and_the_oldest_document_wins() -> None:
    documents = [_doc("Inn", OTHER, age=2), _doc("Inn", DOC, age=1)]
    tags = [_doc("Inn", TAG)]

    assert convert_plain_mentions("#Inn", documents, tags) == f"#[Inn](doc:{DOC})"


def test_existing_tokens_and_blank_names_are_left_alone() -> None:
    documents = [_doc("Castle", DOC), _doc("  ", OTHER)]
    text = f"@[#Castle](user:{ALICE})#Castle #[Castle](doc:{DOC}) # x"

    assert convert_plain_mentions(text, documents, []) == text


def test_a_name_must_end_before_the_next_token() -> None:
    documents = [_doc("Castle", DOC)]
    text = f"#Cas#[Castle](doc:{DOC}) and #Castle"

    assert convert_plain_mentions(text, documents, []) == (
        f"#Cas#[Castle](doc:{DOC}) and #[Castle](doc:{DOC})"
    )


def test_converting_without_targets_changes_nothing() -> None:
    assert convert_plain_mentions("#Castle and #", [], []) == "#Castle and #"
