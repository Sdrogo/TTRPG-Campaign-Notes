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
    target_excerpt,
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
    # Document and Tag tokens stay tokens, a member reads as their name.
    assert planned[0] == PlannedMention(
        DOC, None, text.replace(f"@[Alice](user:{ALICE})", "@Alice")
    )


def test_a_short_text_is_its_own_excerpt_with_spaces_collapsed() -> None:
    text = f"Go to\n\n  #[Castle](doc:{DOC})   tonight."

    assert mention_excerpt(text, find_mentions(text)[0]) == f"Go to #[Castle](doc:{DOC}) tonight."


def test_a_long_text_is_cut_on_words_around_the_mention() -> None:
    before = " ".join(f"before{i}" for i in range(30))
    after = " ".join(f"after{i}" for i in range(30))
    text = f"{before} #[Castle](doc:{DOC}) {after}"

    excerpt = mention_excerpt(text, find_mentions(text)[0], length=40)

    assert excerpt == f"… before29 #[Castle](doc:{DOC}) after0 after1…"


def test_room_one_side_does_not_use_goes_to_the_other() -> None:
    after = " ".join(f"after{i}" for i in range(30))
    text = f"Hi #[Castle](doc:{DOC}) {after}"

    excerpt = mention_excerpt(text, find_mentions(text)[0], length=40)

    assert excerpt == f"Hi #[Castle](doc:{DOC}) after0 after1 after2 after3…"


def test_a_cut_inside_one_long_word_keeps_only_the_ellipsis() -> None:
    text = f"{'x' * 50}#[C](doc:{DOC}) {'y' * 50}"
    mention = find_mentions(text)[0]

    assert mention_excerpt(text, mention, length=10) == f"…#[C](doc:{DOC})…"


def test_tokens_around_the_mention_stay_whole_and_count_as_their_name() -> None:
    long_name = "The Very Long Name Of A Place"
    text = (
        f"{'w ' * 20}#[{long_name}](tag:{TAG}) near #[Castle](doc:{DOC}) "
        f"with @[Alice](user:{ALICE}) {'z ' * 20}"
    )
    mention = find_mentions(text)[1]

    # The ids don't eat the budget, and a cut never splits a name.
    assert mention_excerpt(text, mention, length=60) == (
        f"… near #[Castle](doc:{DOC}) with @Alice z z z z z z z…"
    )
    assert mention_excerpt(text, mention, length=90).startswith(f"… w w #[{long_name}](tag:{TAG})")


def test_a_token_too_long_for_the_room_is_left_out_not_cut() -> None:
    text = f"#[A long name](tag:{TAG}) #[Castle](doc:{DOC})"
    mention = find_mentions(text)[1]

    assert mention_excerpt(text, mention, length=10) == f"… #[Castle](doc:{DOC})"


def test_a_placeholder_character_in_the_text_never_reads_as_a_token() -> None:
    text = f"\U00100000 #[Castle](doc:{DOC}) \U00100001"

    assert mention_excerpt(text, find_mentions(text)[0]) == f"\ufffd #[Castle](doc:{DOC}) \ufffd"


def test_the_excerpt_of_a_target_is_cut_around_its_first_mention() -> None:
    text = f"A #[NPC](tag:{TAG}) then #[Castle](doc:{DOC}) and #[Castle](doc:{DOC})"

    assert target_excerpt(text, DOC, None) == text
    assert target_excerpt(text, None, TAG) == text
    assert target_excerpt(text, None, DOC) is None


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
