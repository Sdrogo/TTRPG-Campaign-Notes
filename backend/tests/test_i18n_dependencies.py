"""`get_locale`'s `Accept-Language` parsing: quality order, base-language
reduction, and the fallback to `DEFAULT_LOCALE`."""

import pytest

from app.i18n.dependencies import get_locale
from app.i18n.translator import DEFAULT_LOCALE


def test_no_header_falls_back_to_default() -> None:
    assert get_locale(None) == DEFAULT_LOCALE


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("it", "it"),
        ("it-IT", "it"),
        ("en-US,en;q=0.9", "en"),
        ("fr-FR,fr;q=0.9,it;q=0.8", "it"),
        ("it;q=0.5,en;q=0.9", "en"),
        ("fr-FR,de-DE", DEFAULT_LOCALE),
        ("", DEFAULT_LOCALE),
        (" , ,", DEFAULT_LOCALE),
    ],
)
def test_picks_the_highest_quality_supported_locale(header: str, expected: str) -> None:
    assert get_locale(header) == expected


def test_a_malformed_quality_value_is_treated_as_default_quality() -> None:
    assert get_locale("it;q=not-a-number") == "it"
