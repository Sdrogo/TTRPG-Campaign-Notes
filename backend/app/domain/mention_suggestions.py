"""Generated mentions (spec 39): where the names of a Room's Documents appear
in a text as plain words, so they can be proposed as mentions and, once
chosen, written as the same tokens a typed mention is (spec 20); and the
Document names a save links by itself (Decision 10)."""

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
    inclusive, `end` exclusive), the words as written and what it would link
    to."""

    start: int
    end: int
    text: str
    kind: MentionKind
    target_id: uuid.UUID
    target_name: str


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
    documents: Sequence[MentionCandidate], exclude_document_id: uuid.UUID | None = None
) -> list[MentionCandidate]:
    """The Document names worth looking for (Decision 5), longest first: no
    name shorter than `MIN_NAME_LENGTH`, none two Documents share, and not
    the Document's own. Tags are never looked for (product owner,
    2026-10-19)."""
    counts = Counter(document.name.casefold() for document in documents)
    usable = [
        document
        for document in documents
        if counts[document.name.casefold()] == 1
        and document.id != exclude_document_id
        and len(document.name.strip()) >= MIN_NAME_LENGTH
    ]
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
        # A match sent twice is written once.
        if suggestion not in picked:
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


def link_new_names(text: str, previous: str, candidates: Sequence[MentionCandidate]) -> str:
    """`text`, just saved over `previous`, with the names of `candidates`
    the save added linked (Decision 10): only in the part of the text the
    save changed, and only for a target named more often than before
    (plain words and tokens together), so turning a mention back into plain
    words, or editing around a name left plain, never links it again."""
    if text == previous:
        return text
    prefix = 0
    limit = min(len(text), len(previous))
    while prefix < limit and text[prefix] == previous[prefix]:
        prefix += 1
    suffix = 0
    while suffix < limit - prefix and text[-1 - suffix] == previous[-1 - suffix]:
        suffix += 1
    changed_end = len(text) - suffix
    found = suggest_mentions(text, candidates)
    grown = _named_counts(text, found) - _named_counts(
        previous, suggest_mentions(previous, candidates)
    )
    picked = [
        m for m in found if grown[m.target_id] > 0 and m.start < changed_end and m.end > prefix
    ]
    return apply_mentions(text, picked)


def _named_counts(text: str, found: Sequence[MentionSuggestion]) -> Counter[uuid.UUID]:
    """How many times `text` names each target: plain occurrences `found`
    plus Document and Tag tokens."""
    counts = Counter(m.target_id for m in found)
    counts.update(m.target_id for m in find_mentions(text) if m.kind is not MentionKind.USER)
    return counts


def match_context(text: str, match: MentionSuggestion) -> tuple[str, str]:
    """About `CONTEXT_LENGTH` characters of `text` on each side of `match`,
    as a reader sees them, cut on words, for the preview."""
    return _tail(text[: match.start]), _head(text[match.end :])


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
