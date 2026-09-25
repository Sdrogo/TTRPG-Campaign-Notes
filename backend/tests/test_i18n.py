"""The message resource files stay in sync, and `translate` renders,
interpolates and falls back the way `app/api/errors.py` relies on."""

import re
from typing import Any

import pytest

from app.i18n.translator import _RESOURCES, DEFAULT_LOCALE, SUPPORTED_LOCALES, translate

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _keys(node: Any, prefix: str = "") -> set[str]:
    """Every dotted leaf key under `node`, mirroring the frontend's own
    `locales.test.ts` key-parity check."""
    if not isinstance(node, dict):
        return {prefix}
    keys: set[str] = set()
    for name, value in node.items():
        path = f"{prefix}.{name}" if prefix else name
        keys |= _keys(value, path)
    return keys


def test_every_supported_locale_has_the_same_keys() -> None:
    reference = _keys(_RESOURCES[DEFAULT_LOCALE])
    for locale in SUPPORTED_LOCALES:
        assert _keys(_RESOURCES[locale]) == reference, locale


def test_every_supported_locale_has_the_same_placeholders() -> None:
    """A `{max}` in English must stay a `{max}` in Italian - the caller's
    `**params` are the same for every locale, so a renamed or dropped
    placeholder would 500 or silently swallow a value."""

    def placeholders(node: Any, prefix: str = "") -> dict[str, set[str]]:
        found: dict[str, set[str]] = {}
        if isinstance(node, dict):
            for name, value in node.items():
                found.update(placeholders(value, f"{prefix}.{name}" if prefix else name))
        else:
            found[prefix] = set(_PLACEHOLDER.findall(node))
        return found

    reference = placeholders(_RESOURCES[DEFAULT_LOCALE])
    for locale in SUPPORTED_LOCALES:
        assert placeholders(_RESOURCES[locale]) == reference, locale


def test_translate_renders_the_requested_locale() -> None:
    assert translate("errors.document.notFound", "en") == "Document not found"
    assert translate("errors.document.notFound", "it") == "Documento non trovato"


def test_translate_interpolates_params() -> None:
    assert translate("errors.document.tooManyImages", "en", max=20) == (
        "A Document can have at most 20 images"
    )


def test_translate_falls_back_to_default_locale_for_an_unsupported_locale() -> None:
    assert translate("errors.document.notFound", "fr") == "Document not found"


def test_translate_falls_back_to_the_key_for_an_unknown_key() -> None:
    assert translate("errors.nope.notReal", "en") == "errors.nope.notReal"


def test_translate_resolves_an_at_prefixed_param_as_a_key_first() -> None:
    rendered = translate(
        "errors.account.fieldTooLong", "it", field="@errors.account.fields.bio", max=1000
    )
    assert rendered == "Biografia deve avere al massimo 1000 caratteri"


@pytest.mark.parametrize("locale", SUPPORTED_LOCALES)
def test_every_key_renders_without_a_missing_placeholder(locale: str) -> None:
    """Every leaf can be rendered with no params at all without raising -
    `translate` swallows a missing placeholder rather than 500ing."""

    def check(node: Any, prefix: str = "") -> None:
        if isinstance(node, dict):
            for name, value in node.items():
                check(value, f"{prefix}.{name}" if prefix else name)
        else:
            translate(prefix, locale)

    check(_RESOURCES[locale])
