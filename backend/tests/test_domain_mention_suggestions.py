"""Generated mentions (spec 39): which names are looked for, where they are
found in a text, and how the chosen ones are written as tokens."""

import uuid

import pytest

from app.domain.mention_suggestions import (
    ChosenMatch,
    MentionCandidate,
    StaleSuggestionsError,
    apply_mentions,
    choose_matches,
    suggest_mentions,
    usable_candidates,
)
from app.domain.mentions import MentionKind, find_mentions

LYRA = uuid.UUID("11111111-1111-4111-8111-111111111111")
INN = uuid.UUID("22222222-2222-4222-8222-222222222222")
CASTLE = uuid.UUID("33333333-3333-4333-8333-333333333333")
TWIN = uuid.UUID("44444444-4444-4444-8444-444444444444")
NORTH = uuid.UUID("55555555-5555-4555-8555-555555555555")
SELF = uuid.UUID("66666666-6666-4666-8666-666666666666")


def _doc(id_: uuid.UUID, name: str) -> MentionCandidate:
    return MentionCandidate(MentionKind.DOCUMENT, id_, name)


def _tag(id_: uuid.UUID, name: str) -> MentionCandidate:
    return MentionCandidate(MentionKind.TAG, id_, name)


def test_candidates_drop_short_shared_own_and_shadowed_names() -> None:
    documents = [
        _doc(LYRA, "Lyra"),
        _doc(INN, "Ox"),
        _doc(CASTLE, "Twin"),
        _doc(TWIN, "twin"),
        _doc(SELF, "Self"),
        _doc(uuid.uuid4(), "Castello Drakon"),
    ]
    tags = [_tag(NORTH, "Nord"), _tag(uuid.uuid4(), "LYRA")]

    names = [c.name for c in usable_candidates(documents, tags, exclude_document_id=SELF)]

    assert names == ["Castello Drakon", "Lyra", "Nord"]


def test_every_whole_word_occurrence_is_proposed_ignoring_case() -> None:
    candidates = usable_candidates(
        [_doc(LYRA, "Lyra"), _doc(INN, "Locanda")], [_tag(NORTH, "Nord")]
    )
    text = "Lyra entra nella locanda. LYRA va a nord, non a Lyrabel."

    found = suggest_mentions(text, candidates)

    assert [(s.text, s.kind, s.target_id, s.target_name) for s in found] == [
        ("Lyra", MentionKind.DOCUMENT, LYRA, "Lyra"),
        ("locanda", MentionKind.DOCUMENT, INN, "Locanda"),
        ("LYRA", MentionKind.DOCUMENT, LYRA, "Lyra"),
        ("nord", MentionKind.TAG, NORTH, "Nord"),
    ]
    assert all(text[s.start : s.end] == s.text for s in found)


def test_accents_count_and_the_longest_name_wins() -> None:
    candidates = usable_candidates(
        [_doc(CASTLE, "Castello Drakon"), _doc(LYRA, "Drakon"), _doc(INN, "Città")], []
    )

    found = suggest_mentions("Il castello Drakon domina la citta e la Città.", candidates)

    assert [(s.text, s.target_id) for s in found] == [
        ("castello Drakon", CASTLE),
        ("Città", INN),
    ]


def test_existing_tokens_and_plain_mentions_are_left_alone() -> None:
    candidates = usable_candidates([_doc(LYRA, "Lyra")], [])
    text = f"#[Lyra](doc:{LYRA}) e #Lyra e @Lyra e Lyra"

    found = suggest_mentions(text, candidates)

    assert [(s.start, s.text) for s in found] == [(len(text) - 4, "Lyra")]


def test_nothing_to_look_for_proposes_nothing() -> None:
    assert suggest_mentions("Lyra", []) == []


def test_context_reads_like_the_text_and_is_cut_on_words() -> None:
    candidates = usable_candidates([_doc(LYRA, "Lyra")], [_tag(NORTH, "Nord")])
    before = "uno due tre quattro cinque sei sette otto nove dieci undici"
    after = "alfa beta gamma delta epsilon zeta eta theta iota kappa lambda"
    text = f"{before}\n\n#[Nord](tag:{NORTH}) Lyra   {after}"

    (found,) = suggest_mentions(text, candidates)

    assert found.before == "… sei sette otto nove dieci undici #Nord "
    assert found.after == " alfa beta gamma delta epsilon zeta eta…"


def test_context_without_spaces_is_cut_anyway() -> None:
    candidates = usable_candidates([_doc(LYRA, "Lyra")], [])
    text = f"{'x' * 50} Lyra {'y' * 50}"

    (found,) = suggest_mentions(text, candidates)

    assert found.before == "…" + " " + "x" * 39 or found.before.startswith("…")
    assert found.after.endswith("…")


def test_chosen_matches_are_written_as_tokens_keeping_the_words() -> None:
    candidates = usable_candidates([_doc(LYRA, "Lyra"), _doc(INN, "Locanda")], [])
    text = "Lyra entra nella locanda] di Lyra."
    found = suggest_mentions(text, candidates)
    chosen = [ChosenMatch(s.start, s.end, s.kind, s.target_id) for s in found[:2]]

    written = apply_mentions(text, choose_matches(found, chosen))

    assert written == (f"#[Lyra](doc:{LYRA}) entra nella #[locanda](doc:{INN})] di Lyra.")
    assert [m.name for m in find_mentions(written)] == ["Lyra", "locanda"]


def test_a_match_no_longer_in_the_text_is_stale() -> None:
    candidates = usable_candidates([_doc(LYRA, "Lyra")], [])
    found = suggest_mentions("Ecco Lyra", candidates)

    with pytest.raises(StaleSuggestionsError):
        choose_matches(found, [ChosenMatch(0, 4, MentionKind.DOCUMENT, LYRA)])
