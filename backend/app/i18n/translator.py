"""Loads the message resource files and renders one key for one locale."""

import json
from pathlib import Path
from typing import Any

SUPPORTED_LOCALES: tuple[str, ...] = ("en", "it")
DEFAULT_LOCALE = "en"

_LOCALES_DIR = Path(__file__).parent / "locales"


def _load(locale: str) -> dict[str, Any]:
    """The parsed resource file for `locale` - called once per supported
    locale, at import time, so a malformed file fails at startup rather
    than on the first request that needs it."""
    with (_LOCALES_DIR / f"{locale}.json").open(encoding="utf-8") as handle:
        data: dict[str, Any] = json.load(handle)
        return data


_RESOURCES: dict[str, dict[str, Any]] = {locale: _load(locale) for locale in SUPPORTED_LOCALES}


def _lookup(resources: dict[str, Any], key: str) -> str | None:
    """The string at the dotted path `key` (e.g. `errors.document.notOwner`)
    inside `resources`, or None if any segment is missing or the leaf isn't
    a string."""
    node: Any = resources
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def _is_key_ref(value: Any) -> bool:
    """Whether a param value is itself a translation key (the `@` prefix)
    rather than a literal to interpolate as-is."""
    return isinstance(value, str) and value.startswith("@")


def translate(key: str, locale: str, **params: Any) -> str:
    """Renders `key` in `locale`, falling back to `DEFAULT_LOCALE` when the
    locale is unsupported or doesn't have that key, and finally to the key
    itself so a typo fails loud (an unreadable `detail`) rather than 500ing.

    A param value starting with `@` is itself a key, translated first in the
    same locale (used to localize an enum-like value, e.g. a profile field
    name, before it's interpolated into the outer message) - see
    `app/domain/profiles.py::ProfileFieldTooLongError`.
    """
    resources = _RESOURCES.get(locale, _RESOURCES[DEFAULT_LOCALE])
    template = _lookup(resources, key) or _lookup(_RESOURCES[DEFAULT_LOCALE], key) or key

    resolved_params = {
        name: translate(value[1:], locale) if _is_key_ref(value) else value
        for name, value in params.items()
    }
    try:
        return template.format(**resolved_params)
    except (KeyError, IndexError):
        return template
