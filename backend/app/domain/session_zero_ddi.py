"""The DDI module of Session 0 (spec 47 Decisions 8 and 8a): one Document
of the Room the Players read and accept, and the template the Master can
start it from. Pure: the repository stores the acceptances, the API reads
the Document and creates it."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.session_zero import ModuleKind


@dataclass(frozen=True)
class Acceptance:
    """A Player's "I have read and accept", at `accepted_at`."""

    module_id: uuid.UUID
    user_id: uuid.UUID
    accepted_at: datetime


class NotDdiModuleError(DomainError):
    """The module isn't a DDI one."""


class NoDdiDocumentError(DomainError):
    """The Master hasn't picked the DDI's Document yet."""


class MasterDoesNotAcceptError(DomainError):
    """The Master writes the DDI; Players accept it (Decision 8)."""


def ensure_ddi_module(kind: ModuleKind) -> None:
    """422 for a module that isn't a DDI one."""
    if kind is not ModuleKind.DDI:
        raise NotDdiModuleError("errors.sessionZero.notDdiModule")


def ensure_can_accept(role: RoomRole, document_id: uuid.UUID | None) -> uuid.UUID:
    """Decision 8: a Player accepts the module's Document, once there is one."""
    if role is RoomRole.MASTER:
        raise MasterDoesNotAcceptError("errors.sessionZero.masterDoesNotAccept")
    if document_id is None:
        raise NoDdiDocumentError("errors.sessionZero.noDdiDocument")
    return document_id


def is_outdated(acceptance: Acceptance, changed_at: datetime | None) -> bool:
    """Decision 8: the Document changed after the Player accepted it."""
    return changed_at is not None and changed_at > acceptance.accepted_at


def can_read_acceptance(acceptance: Acceptance, viewer_id: uuid.UUID, role: RoomRole) -> bool:
    """The Master sees every Player's acceptance, a Player their own."""
    return role is RoomRole.MASTER or acceptance.user_id == viewer_id


# Decision 8a: the six sections of "I GDR e la Dichiarazione d'Intenti" by
# Riccardo "Musta" Caverni, in two groups, with the manual's checklist.
# Only the headings are translated (`sessionZero.ddi.*` in the locale
# files); the checklist and the credit stay Italian for now.
_TEMPLATE: tuple[tuple[str, str, tuple[tuple[str, tuple[str, ...]], ...]], ...] = (
    (
        "behind",
        "behindHint",
        (
            (
                "meeting",
                (
                    "Beer-first o Game-first",
                    "Dove",
                    "Quando (durata, frequenza, tempistiche, vacanze)",
                    "Numero di giocatori (giocatori assenti)",
                    "Periodo di tolleranza (grace period)",
                ),
            ),
            ("rules", ("Sistema", "Regole scartate", "Regole opzionali", "Home rules")),
            ("setting", ("Risorse", "Descrizione", "Integrazione dei personaggi")),
        ),
    ),
    (
        "onTable",
        "onTableHint",
        (
            (
                "themes",
                (
                    "Principali (3+)",
                    "Secondarie (5-)",
                    "Non presenti",
                    "Scomode",
                    "PG contro PG",
                    "Introdurre nuove tematiche",
                    "La morte del personaggio",
                ),
            ),
            (
                "tone",
                (
                    "Parole chiave (5-)",
                    "Riferimenti multimediali",
                    "Contesto di metagame",
                    "Rompere la quarta parete",
                    "Umorismo",
                    "Controllo della scena",
                    "Dialoghi",
                ),
            ),
            (
                "characters",
                ("Obiettivi", "Limiti", "Creazione", "Esperienza", "Background"),
            ),
        ),
    ),
)
_CREDIT = '*Struttura dalla Dichiarazione d\'Intenti di Riccardo "Musta" Caverni.*'


def ddi_template(heading: Callable[[str], str]) -> str:
    """The DDI template's description (Decision 8a): each group a `##`
    heading with its line, each section a `###` heading with its checklist
    to fill in, then the credit. `heading` names a `sessionZero.ddi.*` key
    in the Master's language."""
    parts: list[str] = []
    for group, hint, sections in _TEMPLATE:
        parts.append(f"## {heading(group)}")
        parts.append(f"*{heading(hint)}*")
        for section, items in sections:
            parts.append(f"### {heading(section)}")
            parts.append("\n".join(f"- {item}:" for item in items))
    parts.append("---")
    parts.append(_CREDIT)
    return "\n\n".join(parts)
