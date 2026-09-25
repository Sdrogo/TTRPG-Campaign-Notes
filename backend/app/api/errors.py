"""Turns a message key, or a caught `DomainError`, into the `HTTPException`
a route raises - the one place `detail` text is rendered, so every route
renders it in the caller's locale the same way (`app/i18n`)."""

from typing import Any

from fastapi import HTTPException

from app.domain.errors import DomainError
from app.i18n.translator import translate


def http_error(status_code: int, key: str, locale: str, **params: Any) -> HTTPException:
    """An `HTTPException` whose `detail` is `key` rendered in `locale` - for
    the checks that build their own error rather than catching a
    `DomainError` (e.g. "not a member of this room")."""
    return HTTPException(status_code, translate(key, locale, **params))


def translated_error(status_code: int, exc: DomainError, locale: str) -> HTTPException:
    """An `HTTPException` for a caught `DomainError`, translated from its
    `key`/`params` rather than from `str(exc)`."""
    return HTTPException(status_code, translate(exc.key, locale, **exc.params))
