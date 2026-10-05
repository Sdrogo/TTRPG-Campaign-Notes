"""Full-text search rules (spec 21): the prefix query, the kinds a request
searches, paging after the visibility filter, and excerpts as offsets."""

import uuid

from app.domain.search import (
    START_MARK,
    STOP_MARK,
    Highlighted,
    SearchKind,
    first_page,
    kinds_to_search,
    prefix_query,
    read_headline,
    searchable_text,
)


def _mark(word: str) -> str:
    return f"{START_MARK}{word}{STOP_MARK}"


def test_every_term_is_a_required_prefix() -> None:
    assert prefix_query("dra") == "dra:*"
    assert prefix_query("  Città   del-drago ") == "Città:* & del:* & drago:*"


def test_query_syntax_never_reaches_postgres() -> None:
    # Decision 4: only letters and digits make terms; operators separate them.
    assert prefix_query("a & !b | (c:*) <-> 'd'") == "a:* & b:* & c:* & d:*"
    assert prefix_query("snake_case") == "snake:* & case:*"


def test_a_query_under_two_characters_finds_nothing() -> None:
    assert prefix_query("") is None
    assert prefix_query("d") is None
    assert prefix_query("!?* -") is None
    assert prefix_query("dr") == "dr:*"
    assert prefix_query("a b") == "a:* & b:*"


def test_kinds_searched() -> None:
    assert kinds_to_search(None, False) == set(SearchKind)
    assert kinds_to_search(SearchKind.NOTE, False) == {SearchKind.NOTE}
    # Decision 6: a Tag filter keeps results from tagged Documents only.
    assert kinds_to_search(None, True) == set(SearchKind) - {SearchKind.TAG}
    assert kinds_to_search(SearchKind.TAG, True) == set()


def test_first_page_says_whether_more_are_visible() -> None:
    ids = [uuid.uuid4() for _ in range(3)]
    assert first_page(ids, 3) == (ids, False)
    assert first_page(ids, 2) == (ids[:2], True)
    assert first_page([], 10) == ([], False)


def test_searchable_text_is_what_the_reader_sees() -> None:
    target = uuid.uuid4()
    raw = f"Il  #[Drago](doc:{target})\n\nvive {START_MARK}qui{STOP_MARK}"
    assert searchable_text(raw) == "Il #Drago vive qui"


def test_a_whole_text_has_no_ellipsis() -> None:
    source = "La Città del Drago"
    assert read_headline(f"La {_mark('Città')} del {_mark('Drago')}", source) == Highlighted(
        text=source, highlights=((3, 8), (13, 18))
    )


def test_an_excerpt_marks_where_it_was_cut() -> None:
    source = "uno due tre quattro cinque"
    assert read_headline(f"due {_mark('tre')}", source) == Highlighted(
        text="… due tre …", highlights=((6, 9),)
    )
    assert read_headline(f"{_mark('uno')} due", source) == Highlighted(
        text="uno due …", highlights=((0, 3),)
    )
    assert read_headline(f"quattro {_mark('cinque')}", source) == Highlighted(
        text="… quattro cinque", highlights=((10, 16),)
    )


def test_offsets_count_utf16_code_units_like_javascript() -> None:
    # An emoji is one Python character but two JavaScript ones.
    source = "\U0001f409 drago"
    assert read_headline(f"\U0001f409 {_mark('drago')}", source) == Highlighted(
        text=source, highlights=((3, 8),)
    )


def test_stray_or_empty_markers_mark_nothing() -> None:
    source = "drago rosso"
    assert read_headline(f"{STOP_MARK}drago {START_MARK}{STOP_MARK}rosso", source) == (
        Highlighted(text=source, highlights=())
    )
