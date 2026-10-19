"""Generated mentions (spec 39): where the names of a Room's Documents and Tags
appear in a text as plain words, so they can be proposed as mentions and,
once chosen, written as the same tokens a typed mention is (spec 20)."""

import re
import uuid
from collections import Counter
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from app.domain.errors import DomainError
from app.domain.mentions import MentionKind, display_text, find_mentions, mention_token

# Shorter names would be found inside too much ordinary prose (Decision 5).
MIN_NAME_LENGTH = 3
# About how many characters of context a proposal shows on each side.
CONTEXT_LENGTH = 40
_ELLIPSIS = "…"
_SPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class MentionCandidate:
    """A Document or a Tag whose name may be proposed as a mention."""

    kind: MentionKind
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class MentionSuggestion:
    """One occurrence of a candidate's name in a text: where it is (`start`
    inclusive, `end` exclusive), the words as written, what it would link
    to, and a little of the text around it as a reader sees it."""

    start: int
    end: int
    text: str
    kind: MentionKind
    target_id: uuid.UUID
    target_name: str
    before: str
    after: str


@dataclass(frozen=True)
class ChosenMatch:
    """A proposal the user kept, as the browser sends it back."""

    start: int
    end: int
    kind: MentionKind
    target_id: uuid.UUID


class StaleSuggestionsError(DomainError):
    """A chosen proposal is no longer in the text: it was edited since the
    preview was made (Decision 7)."""


def usable_candidates(
    documents: Sequence[MentionCandidate],
    tags: Sequence[MentionCandidate],
    exclude_document_id: uuid.UUID | None = None,
) -> list[MentionCandidate]:
    """The names worth looking for (Decision 5), longest first: no name
    shorter than `MIN_NAME_LENGTH`, none two Documents share, not the
    Document's own, and no Tag named like a Document (the Document wins)."""
    counts = Counter(document.name.casefold() for document in documents)
    kept_documents = [
        document
        for document in documents
        if counts[document.name.casefold()] == 1 and document.id != exclude_document_id
    ]
    document_names = set(counts)
    kept_tags = [tag for tag in tags if tag.name.casefold() not in document_names]
    usable = [
        candidate
        for candidate in kept_documents + kept_tags
        if len(candidate.name.strip()) >= MIN_NAME_LENGTH
    ]
    # Stable, so a Document stays ahead of a Tag of the same length.
    return sorted(usable, key=lambda candidate: -len(candidate.name))


def _pattern(candidates: Sequence[MentionCandidate]) -> re.Pattern[str]:
    """One expression matching any candidate's name as a whole word, not
    right after a `#` or `@` (a plain mention the browser already shows),
    longest name first so an alternation picks it. Each name is its own
    group (`c<index>`), so a match says which candidate it found."""
    names = "|".join(
        f"(?P<c{index}>{re.escape(candidate.name)})" for index, candidate in enumerate(candidates)
    )
    return re.compile(rf"(?<![\w#@])(?:{names})(?!\w)", re.IGNORECASE)


def suggest_mentions(text: str, candidates: Sequence[MentionCandidate]) -> list[MentionSuggestion]:
    """Every occurrence in `text` of a name of `candidates` (already
    `usable_candidates`, longest first) outside existing tokens, in order,
    by the rules of Decisions 4 and 5."""
    if not candidates:
        return []
    pattern = _pattern(candidates)
    found: list[MentionSuggestion] = []
    start = 0
    bounds = [(m.start, m.end) for m in find_mentions(text)] + [(len(text), len(text))]
    for token_start, token_end in bounds:
        for match in pattern.finditer(text, start, token_start):
            candidate = candidates[int(str(match.lastgroup)[1:])]
            found.append(
                MentionSuggestion(
                    start=match.start(),
                    end=match.end(),
                    text=match.group(),
                    kind=candidate.kind,
                    target_id=candidate.id,
                    target_name=candidate.name,
                    before=_tail(text[: match.start()]),
                    after=_head(text[match.end() :]),
                )
            )
        start = token_end
    return found


def choose_matches(
    current: Sequence[MentionSuggestion], chosen: Collection[ChosenMatch]
) -> list[MentionSuggestion]:
    """The current proposals the user chose; `StaleSuggestionsError` when
    one of `chosen` isn't among them any more."""
    by_key = {(s.start, s.end, s.kind, s.target_id): s for s in current}
    picked: list[MentionSuggestion] = []
    for match in chosen:
        suggestion = by_key.get((match.start, match.end, match.kind, match.target_id))
        if suggestion is None:
            raise StaleSuggestionsError("errors.mentionSuggestions.stale")
        picked.append(suggestion)
    return picked


def apply_mentions(text: str, matches: Sequence[MentionSuggestion]) -> str:
    """`text` with each of `matches` written as a token keeping the words as
    written (Decision 6). The matches don't overlap: they come from one
    `suggest_mentions`."""
    parts: list[str] = []
    last = 0
    for match in sorted(matches, key=lambda m: m.start):
        parts.append(text[last : match.start])
        parts.append(mention_token(match.kind, match.target_id, text[match.start : match.end]))
        last = match.end
    parts.append(text[last:])
    return "".join(parts)


def _tail(text: str) -> str:
    """The end of the text before a match, as a reader sees it: at most
    about `CONTEXT_LENGTH` characters, starting on a word."""
    shown = _SPACES.sub(" ", display_text(text)).lstrip()
    if len(shown) <= CONTEXT_LENGTH:
        return shown
    cut = shown[-CONTEXT_LENGTH:]
    space = cut.find(" ")
    return _ELLIPSIS + (cut[space:] if space != -1 else cut)


def _head(text: str) -> str:
    """The start of the text after a match, as a reader sees it: at most
    about `CONTEXT_LENGTH` characters, ending on a word."""
    shown = _SPACES.sub(" ", display_text(text)).rstrip()
    if len(shown) <= CONTEXT_LENGTH:
        return shown
    cut = shown[:CONTEXT_LENGTH]
    space = cut.rfind(" ")
    return (cut[:space] if space != -1 else cut) + _ELLIPSIS
