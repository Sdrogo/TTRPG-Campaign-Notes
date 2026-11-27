"""Rules for Glossary entries (spec 79): who manages them, the shape of a term
and its aliases, the keys that make a word unique in a Room, and the visibility
audit. Who can *see* an entry is `visibility.is_glossary_entry_visible`, the
same filter as every other content (Invariant 1)."""

import unicodedata
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, DocumentVisibility, Membership, RoomRole

MAX_TERM_LENGTH = 120
MAX_ALIASES = 10
MAX_DEFINITION_LENGTH = 10_000
MAX_RELATED_DOCUMENTS = 20
MAX_ENTRIES_PER_ROOM = 2_000

GLOSSARY_VISIBILITY_CHANGED = "glossary_visibility_changed"


class NotGlossaryManagerError(DomainError):
    """The requester is neither an Administrator nor the Master."""


class TermRequiredError(DomainError):
    """The term is empty once trimmed."""


class TermTooLongError(DomainError):
    """The term or an alias is over `MAX_TERM_LENGTH`."""


class TooManyAliasesError(DomainError):
    """More than `MAX_ALIASES` aliases."""


class DefinitionTooLongError(DomainError):
    """The definition is over `MAX_DEFINITION_LENGTH`."""


class TooManyRelatedDocumentsError(DomainError):
    """More than `MAX_RELATED_DOCUMENTS` linked Documents."""


class TooManyEntriesError(DomainError):
    """The Room already has `MAX_ENTRIES_PER_ROOM` entries."""


class DuplicateTermError(DomainError):
    """A term or alias is already the term or an alias of another entry (or
    of this one, twice)."""


@dataclass(frozen=True)
class GlossaryEntry:
    """A Glossary entry. Its Tags, linked Documents and Selective grants are
    separate rows, read next to it."""

    id: uuid.UUID
    room_id: uuid.UUID
    term: str
    aliases: tuple[str, ...]
    definition: str
    visibility: DocumentVisibility
    highlight: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


def can_manage_glossary(membership: Membership) -> bool:
    """Section 9 ("Manage Tags and Glossary"): the Administrator and the
    Master."""
    return membership.is_admin or membership.role == RoomRole.MASTER


def ensure_can_manage_glossary(membership: Membership) -> None:
    """Raises `NotGlossaryManagerError` unless `can_manage_glossary` holds."""
    if not can_manage_glossary(membership):
        raise NotGlossaryManagerError("errors.glossary.notAllowedToManage")


def term_key(text: str) -> str:
    """The key of a term or alias: lower case with accents removed, spaces
    collapsed. Two words with one key are the same word (Decision 1)."""
    decomposed = unicodedata.normalize("NFD", text.casefold())
    bare = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(bare.split())


def clean_term(term: str) -> str:
    """The trimmed term: non-empty and within `MAX_TERM_LENGTH`."""
    clean = " ".join(term.split())
    if not clean:
        raise TermRequiredError("errors.glossary.termRequired")
    if len(clean) > MAX_TERM_LENGTH:
        raise TermTooLongError("errors.glossary.termTooLong", max=MAX_TERM_LENGTH)
    return clean


def clean_aliases(aliases: Sequence[str]) -> tuple[str, ...]:
    """The aliases trimmed, blank ones dropped, at most `MAX_ALIASES`."""
    cleaned = [" ".join(alias.split()) for alias in aliases]
    cleaned = [alias for alias in cleaned if alias]
    if len(cleaned) > MAX_ALIASES:
        raise TooManyAliasesError("errors.glossary.tooManyAliases", max=MAX_ALIASES)
    for alias in cleaned:
        if len(alias) > MAX_TERM_LENGTH:
            raise TermTooLongError("errors.glossary.termTooLong", max=MAX_TERM_LENGTH)
    return tuple(cleaned)


def clean_definition(definition: str) -> str:
    """The definition, within `MAX_DEFINITION_LENGTH`."""
    if len(definition) > MAX_DEFINITION_LENGTH:
        raise DefinitionTooLongError("errors.glossary.definitionTooLong", max=MAX_DEFINITION_LENGTH)
    return definition


def entry_keys(term: str, aliases: Sequence[str]) -> list[str]:
    """The keys of an entry's term and aliases, in that order. Raises
    `DuplicateTermError` when two of them are the same word."""
    keys = [term_key(term), *(term_key(alias) for alias in aliases)]
    if len(set(keys)) != len(keys):
        raise DuplicateTermError("errors.glossary.duplicateTerm")
    return keys


def clean_related_documents(document_ids: Sequence[uuid.UUID]) -> list[uuid.UUID]:
    """The linked Documents, each once, at most `MAX_RELATED_DOCUMENTS`."""
    unique = list(dict.fromkeys(document_ids))
    if len(unique) > MAX_RELATED_DOCUMENTS:
        raise TooManyRelatedDocumentsError(
            "errors.glossary.tooManyDocuments", max=MAX_RELATED_DOCUMENTS
        )
    return unique


def plan_new_entry(
    room_id: uuid.UUID,
    creator_id: uuid.UUID,
    term: str,
    aliases: Sequence[str],
    definition: str,
    visibility: DocumentVisibility,
    highlight: bool,
    existing_count: int,
    now: datetime,
) -> GlossaryEntry:
    """A new entry. The caller has checked the creator may manage the
    Glossary and that no other entry holds one of its words."""
    if existing_count >= MAX_ENTRIES_PER_ROOM:
        raise TooManyEntriesError("errors.glossary.tooMany", max=MAX_ENTRIES_PER_ROOM)
    clean = clean_term(term)
    cleaned_aliases = clean_aliases(aliases)
    entry_keys(clean, cleaned_aliases)
    return GlossaryEntry(
        id=uuid.uuid4(),
        room_id=room_id,
        term=clean,
        aliases=cleaned_aliases,
        definition=clean_definition(definition),
        visibility=visibility,
        highlight=highlight,
        created_by=creator_id,
        created_at=now,
        updated_at=now,
    )


@dataclass(frozen=True)
class GlossaryEditPlan:
    """The edited entry and the audit entry to write with it when the edit
    changes who can see it."""

    entry: GlossaryEntry
    audit_entry: AuditLogEntry | None


def plan_entry_edit(
    entry: GlossaryEntry,
    editor_id: uuid.UUID,
    now: datetime,
    term: str | None = None,
    aliases: Sequence[str] | None = None,
    definition: str | None = None,
    visibility: DocumentVisibility | None = None,
    highlight: bool | None = None,
    current_selective_ids: Collection[uuid.UUID] = (),
    new_selective_ids: Collection[uuid.UUID] | None = None,
) -> GlossaryEditPlan:
    """Edits an entry; omitted fields stay. Changing its visibility level or
    its Selective grants produces an audit entry (VR-08, Invariant 7)."""
    new_term = entry.term if term is None else clean_term(term)
    new_aliases = entry.aliases if aliases is None else clean_aliases(aliases)
    entry_keys(new_term, new_aliases)
    updated = replace(
        entry,
        term=new_term,
        aliases=new_aliases,
        definition=entry.definition if definition is None else clean_definition(definition),
        visibility=entry.visibility if visibility is None else visibility,
        highlight=entry.highlight if highlight is None else highlight,
        updated_at=now,
    )
    grants_changed = (
        updated.visibility == DocumentVisibility.SELECTIVE
        and new_selective_ids is not None
        and set(new_selective_ids) != set(current_selective_ids)
    )
    audit_entry = None
    if updated.visibility != entry.visibility or grants_changed:
        audit_entry = AuditLogEntry(
            id=uuid.uuid4(),
            room_id=entry.room_id,
            actor_user_id=editor_id,
            target_user_id=None,
            action=GLOSSARY_VISIBILITY_CHANGED,
            details={
                "entry_id": str(entry.id),
                "term": entry.term,
                "from": entry.visibility.value,
                "to": updated.visibility.value,
                # Only a Selective entry keeps grants; the API clears the rest.
                "selective_user_ids": sorted(
                    str(user_id)
                    for user_id in (
                        ()
                        if updated.visibility != DocumentVisibility.SELECTIVE
                        else current_selective_ids
                        if new_selective_ids is None
                        else new_selective_ids
                    )
                ),
            },
        )
    return GlossaryEditPlan(entry=updated, audit_entry=audit_entry)
