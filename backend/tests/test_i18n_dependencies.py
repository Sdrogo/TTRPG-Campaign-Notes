"""`get_locale`'s `Accept-Language` parsing: quality order, base-language
reduction, and the fallback to `DEFAULT_LOCALE`."""

import re
from pathlib import Path

import pytest

from app.i18n.dependencies import get_locale
from app.i18n.translator import DEFAULT_LOCALE, LOCALE_ALIASES, resolve_locale


def test_no_header_falls_back_to_default() -> None:
    assert get_locale(None) == DEFAULT_LOCALE


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("it", "it"),
        ("it-IT", "it"),
        ("en-US,en;q=0.9", "en"),
        ("tr-TR,ar;q=0.9,it;q=0.8", "it"),
        ("ja-JP,ko;q=0.9,it;q=0.8", "ja"),
        ("ko-KR", "ko"),
        ("zh-CN,zh;q=0.9", "zh-Hans"),
        ("fr-FR,fr;q=0.9,it;q=0.8", "fr"),
        ("pt-BR,pt;q=0.9", "pt-PT"),
        ("it;q=0.5,en;q=0.9", "en"),
        ("tr-TR,ar-EG", DEFAULT_LOCALE),
        ("", DEFAULT_LOCALE),
        (" , ,", DEFAULT_LOCALE),
    ],
)
def test_picks_the_highest_quality_supported_locale(header: str, expected: str) -> None:
    assert get_locale(header) == expected


def test_a_malformed_quality_value_is_treated_as_default_quality() -> None:
    assert get_locale("it;q=not-a-number") == "it"


def test_a_q_zero_language_is_excluded_not_just_deprioritized() -> None:
    # q=0 means "not acceptable" (RFC 7231), so it must fall back to
    # English rather than being picked as a low-priority match.
    assert get_locale("it;q=0") == DEFAULT_LOCALE
    assert get_locale("it;q=0,en;q=0.5") == "en"


# Spec 34: regional and script tags. Only `en` and `it` have files today, so
# these run against a larger supported set.
_FUTURE = ("en", "it", "pt-PT", "zh-Hans", "ko")
_FUTURE_WITH_HANT = (*_FUTURE, "zh-Hant")


@pytest.mark.parametrize(
    ("tag", "supported", "expected"),
    [
        ("it-IT", _FUTURE, "it"),
        ("pt", _FUTURE, "pt-PT"),
        ("pt-BR", _FUTURE, "pt-PT"),
        ("pt-pt", _FUTURE, "pt-PT"),
        ("zh-CN", _FUTURE, "zh-Hans"),
        ("zh-Hans-CN", _FUTURE, "zh-Hans"),
        ("zh-TW", _FUTURE, "zh-Hans"),
        ("zh-Hant-HK", _FUTURE, "zh-Hans"),
        ("zh-TW", _FUTURE_WITH_HANT, "zh-Hant"),
        ("zh-Hant-HK", _FUTURE_WITH_HANT, "zh-Hant"),
        ("zh", _FUTURE_WITH_HANT, "zh-Hans"),
        ("KO-kr", _FUTURE, "ko"),
        ("fr-FR", _FUTURE, None),
        ("*", _FUTURE, None),
        ("", _FUTURE, None),
    ],
)
def test_resolve_locale_maps_regional_and_script_tags(
    tag: str, supported: tuple[str, ...], expected: str | None
) -> None:
    assert resolve_locale(tag, supported) == expected


def test_traditional_chinese_reads_simplified_until_it_has_a_file() -> None:
    assert get_locale("zh-TW") == "zh-Hans"


def test_the_alias_table_matches_the_frontend_one() -> None:
    """`LOCALE_ALIASES` and the frontend's `LANGUAGE_ALIASES` must say the same
    thing, or the UI and the API would resolve one browser tag to two
    languages."""
    source = Path(__file__).parents[2] / "frontend" / "src" / "i18n" / "index.ts"
    text = source.read_text(encoding="utf-8")
    start = text.index("LANGUAGE_ALIASES")
    block = text[start : text.index("};", start)]
    frontend = dict(re.findall(r"'?([\w-]+)'?: '([\w-]+)'", block.split("= {", 1)[1]))

    assert frontend == LOCALE_ALIASES
