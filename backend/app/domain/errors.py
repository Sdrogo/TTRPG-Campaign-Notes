"""The base every domain exception carries a message through: a translation
key (see `app/i18n/locales/`) plus the values to interpolate into it,
instead of a rendered English string. Keeps `app/domain/` free of any i18n
or FastAPI dependency (per `code-standards.md`) while still letting the API
layer render `detail` in the caller's locale - see
`app/api/errors.py::translated_error`."""

from typing import Any


class DomainError(Exception):
    """A domain-rule violation identified by `key` and, when the message
    needs interpolation, `params`. `str(exc)` is the key itself, which is
    enough for logs and for tests that only need to assert *which* rule
    fired."""

    def __init__(self, key: str, **params: Any) -> None:
        super().__init__(key)
        self.key = key
        self.params = params
