"""The `LocaleDep` dependency: every route that can return an error resolves
the caller's locale from `Accept-Language`, the same way `CurrentUserDep`
resolves the caller from the `Authorization` header."""

from typing import Annotated

from fastapi import Depends, Header

from app.i18n.translator import DEFAULT_LOCALE, resolve_locale


def _preferred_tags(header: str) -> list[str]:
    """The header's language tags in quality order (`q`, highest first), whole
    (`zh-Hant-HK`), for `resolve_locale` to match. Good enough for choosing
    among a handful of supported locales without a full RFC 4647
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
        tag = tag.strip()
        # q=0 explicitly means "not acceptable" (RFC 7231 §5.3.1), not just
        # low priority - it must be excluded, not merely sorted last.
        if tag and 0 < quality <= 1.0:
            tagged.append((quality, position, tag))
    tagged.sort(key=lambda item: (-item[0], item[1]))
    return [tag for _, _, tag in tagged]


def get_locale(accept_language: Annotated[str | None, Header()] = None) -> str:
    """The first of the caller's `Accept-Language` preferences this backend
    has messages for, or `DEFAULT_LOCALE` when the header is absent or none
    of its preferences are supported."""
    if accept_language:
        for tag in _preferred_tags(accept_language):
            locale = resolve_locale(tag)
            if locale:
                return locale
    return DEFAULT_LOCALE


LocaleDep = Annotated[str, Depends(get_locale)]
