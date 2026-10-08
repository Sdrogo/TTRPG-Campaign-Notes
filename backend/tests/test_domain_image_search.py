import uuid

import pytest

from app.domain.image_search import (
    MAX_PAGE,
    ImageSearchError,
    Throttle,
    license_label,
    normalize_query,
    parse_page,
    parse_result,
)

IMAGE_ID = "4bc43a04-ef46-4544-a0c1-63c63f56e276"


def _raw(**overrides: object) -> dict[str, object]:
    raw: dict[str, object] = {
        "id": IMAGE_ID,
        "title": " Castle at dusk ",
        "url": "https://live.staticflickr.com/1/castle.jpg",
        "thumbnail": "https://elsewhere.example/thumb.jpg",
        "width": 1024,
        "height": 768,
        "creator": "Ada",
        "license": "by-sa",
        "license_version": "2.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/2.0/",
        "foreign_landing_url": "https://www.flickr.com/photos/ada/1",
        "mature": False,
    }
    raw.update(overrides)
    return raw


def test_query_is_trimmed_and_collapsed() -> None:
    assert normalize_query("  red   dragon \n") == "red dragon"


def test_blank_query_is_refused() -> None:
    with pytest.raises(ImageSearchError, match="errors.imageSearch.emptyQuery"):
        normalize_query(" \t ")


@pytest.mark.parametrize(
    ("code", "version", "label"),
    [
        ("by-sa", "4.0", "CC BY-SA 4.0"),
        ("cc0", "1.0", "CC0 1.0"),
        ("pdm", "1.0", "Public Domain Mark 1.0"),
        ("by", None, "CC BY"),
        ("", "1.0", None),
        (None, None, None),
    ],
)
def test_license_label(code: object, version: object, label: str | None) -> None:
    assert license_label(code, version) == label


def test_result_is_mapped_with_the_thumbnail_on_openverse() -> None:
    result = parse_result(_raw())

    assert result is not None
    assert result.id == uuid.UUID(IMAGE_ID)
    # Decision 6: never the upstream thumbnail the result names.
    assert result.thumbnail_url == f"https://api.openverse.org/v1/images/{IMAGE_ID}/thumb/"
    assert result.url == "https://live.staticflickr.com/1/castle.jpg"
    assert (result.width, result.height) == (1024, 768)
    assert result.title == "Castle at dusk"
    assert result.creator == "Ada"
    assert result.license == "CC BY-SA 2.0"
    assert result.license_url == "https://creativecommons.org/licenses/by-sa/2.0/"
    assert result.source_url == "https://www.flickr.com/photos/ada/1"


def test_missing_optional_fields_become_none() -> None:
    result = parse_result(
        _raw(
            title="  ",
            creator=None,
            width=True,
            height=0,
            license=None,
            license_url="javascript:alert(1)",
            foreign_landing_url=None,
        )
    )

    assert result is not None
    assert result.title is None
    assert result.creator is None
    assert (result.width, result.height) == (None, None)
    assert result.license is None
    assert result.license_url is None
    assert result.source_url is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"id": "not-a-uuid"},
        {"id": None},
        {"url": "ftp://example.com/a.jpg"},
        {"url": None},
        {"mature": True},
    ],
)
def test_unusable_results_are_dropped(overrides: dict[str, object]) -> None:
    assert parse_result(_raw(**overrides)) is None


def test_page_keeps_usable_results_and_knows_if_more_exist() -> None:
    raw = {"page_count": 3, "results": [_raw(), _raw(url=None), "junk"]}

    page = parse_page(raw, 1)

    assert [r.id for r in page.results] == [uuid.UUID(IMAGE_ID)]
    assert page.page == 1
    assert page.has_more is True
    assert parse_page(raw, 3).has_more is False


def test_page_never_offers_more_than_max_page() -> None:
    assert parse_page({"page_count": 100, "results": []}, MAX_PAGE).has_more is False
    assert parse_page({"page_count": 100, "results": []}, MAX_PAGE - 1).has_more is True


def test_malformed_page_is_empty() -> None:
    page = parse_page({"results": "nope", "page_count": "many"}, 1)

    assert page.results == []
    assert page.has_more is False


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_throttle_refuses_past_the_limit_until_the_window_moves() -> None:
    clock = _Clock()
    throttle = Throttle(limit=2, window=60, clock=clock)
    user = uuid.uuid4()

    throttle.check(user)
    clock.now += 10
    throttle.check(user)
    with pytest.raises(ImageSearchError, match="errors.imageSearch.throttled"):
        throttle.check(user)

    # The first call leaves the window; the refused one was never counted.
    clock.now += 50
    throttle.check(user)
    with pytest.raises(ImageSearchError):
        throttle.check(user)


def test_throttle_counts_each_user_apart_and_forgets_idle_ones() -> None:
    clock = _Clock()
    throttle = Throttle(limit=1, window=60, clock=clock)
    first, second = uuid.uuid4(), uuid.uuid4()

    throttle.check(first)
    throttle.check(second)
    with pytest.raises(ImageSearchError):
        throttle.check(first)

    clock.now += 61
    throttle.check(second)
    assert list(throttle._calls) == [second]

    throttle.reset()
    assert throttle._calls == {}


def test_throttle_with_no_allowance_refuses_everyone() -> None:
    throttle = Throttle(limit=0, window=60, clock=_Clock())

    for user in (uuid.uuid4(), uuid.uuid4()):
        with pytest.raises(ImageSearchError):
            throttle.check(user)
