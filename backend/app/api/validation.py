"""Request-body types shared by several routers."""

import uuid
from typing import Annotated

from pydantic import AfterValidator


def _dedupe(ids: list[uuid.UUID]) -> list[uuid.UUID]:
    return list(dict.fromkeys(ids))


# A list of ids that becomes one row each in a relationship table (tags,
# Selective grants). Repeats are dropped, order kept, before any code runs:
# a duplicate would otherwise hit the table's composite primary key as an
# IntegrityError (500) instead of being harmless.
UniqueIds = Annotated[list[uuid.UUID], AfterValidator(_dedupe)]
