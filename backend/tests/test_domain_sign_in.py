from datetime import UTC, datetime, timedelta

import pytest

from app.domain.sign_in import (
    ROTATION_GRACE,
    RefreshOutcome,
    allowed_return_origin,
    refresh_outcome,
)

ORIGINS = ["https://exlibris.world", "http://localhost:5173"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://exlibris.world", "https://exlibris.world"),
        ("https://exlibris.world/", "https://exlibris.world"),
        ("HTTPS://ExLibris.World", "https://exlibris.world"),
        ("http://localhost:5173", "http://localhost:5173"),
        ("https://ttrpg-abc-1.vercel.app", None),
        (None, None),
        ("", None),
        ("https://evil.example", None),
        ("https://exlibris.world/rooms", None),
        ("https://exlibris.world/?next=x", None),
        ("https://exlibris.world/#x", None),
        ("https://user@exlibris.world", None),
        ("javascript:alert(1)", None),
        ("//exlibris.world", None),
        ("https://exlibris.world.evil.example", None),
        ("http://exlibris.world", None),
    ],
)
def test_only_the_frontend_origins_are_accepted(value: str | None, expected: str | None) -> None:
    assert allowed_return_origin(value, ORIGINS) == expected


NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(days=10)


def _outcome(**changes: object) -> RefreshOutcome:
    args: dict[str, object] = {
        "matched_current": True,
        "revoked_at": None,
        "expires_at": LATER,
        "rotated_at": None,
        "now": NOW,
    }
    args.update(changes)
    return refresh_outcome(**args)  # type: ignore[arg-type]


def test_the_current_token_rotates() -> None:
    assert _outcome() is RefreshOutcome.ROTATE


def test_a_signed_out_session_is_refused() -> None:
    assert _outcome(revoked_at=NOW - timedelta(minutes=1)) is RefreshOutcome.REFUSE


def test_an_expired_session_is_refused() -> None:
    assert _outcome(expires_at=NOW) is RefreshOutcome.REFUSE


def test_the_previous_token_works_for_a_short_grace() -> None:
    rotated = NOW - ROTATION_GRACE
    assert _outcome(matched_current=False, rotated_at=rotated) is RefreshOutcome.GRACE


def test_the_previous_token_after_the_grace_counts_as_reuse() -> None:
    rotated = NOW - ROTATION_GRACE - timedelta(seconds=1)
    assert _outcome(matched_current=False, rotated_at=rotated) is RefreshOutcome.REUSE


def test_a_previous_token_with_no_rotation_time_counts_as_reuse() -> None:
    assert _outcome(matched_current=False) is RefreshOutcome.REUSE
