"""The `LocaleDep` dependency: every route that can return an error resolves
the caller's locale from `Accept-Language`, the same way `CurrentUserDep`
resolves the caller from the `Authorization` header."""

from typing import Annotated

from fastapi import Depends, Header

from app.i18n.translator import DEFAULT_LOCALE, SUPPORTED_LOCALES


def _preferred_locales(header: str) -> list[str]:
    """The header's language tags in quality order (`q`, highest first),
    reduced to their base language (`it-IT` -> `it`). Good enough for
    choosing among a handful of supported locales without a full RFC 4647
    implementation; ties keep the header's own order."""
    tagged: list[tuple[float, int, str]] = []
    for position, part in enumerate(header.split(",")):
        part = part.strip()
        if not part:
            continue
        tag, _, quality_part = part.partition(";")
        quality = 1.0
        if quality_part:
            try:
                quality = float(quality_part.strip().removeprefix("q="))
            except ValueError:
                quality = 1.0
        base = tag.strip().split("-")[0].lower()
        # q=0 explicitly means "not acceptable" (RFC 7231 §5.3.1), not just
        # low priority - it must be excluded, not merely sorted last.
        if base and 0 < quality <= 1.0:
            tagged.append((quality, position, base))
    tagged.sort(key=lambda item: (-item[0], item[1]))
    return [base for _, _, base in tagged]


def get_locale(accept_language: Annotated[str | None, Header()] = None) -> str:
    """The first of the caller's `Accept-Language` preferences this backend
    has messages for, or `DEFAULT_LOCALE` when the header is absent or none
    of its preferences are supported."""
    if accept_language:
        for base in _preferred_locales(accept_language):
            if base in SUPPORTED_LOCALES:
                return base
    return DEFAULT_LOCALE


LocaleDep = Annotated[str, Depends(get_locale)]
