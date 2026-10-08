import pytest

from app.config import Settings


def load_settings() -> Settings:
    """Reads the environment only, never the developer's local `.env`."""
    return Settings(_env_file=None)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "value",
    [
        '["https://app.example.com","http://localhost:5173"]',
        # As a hosting dashboard's textarea may store it, with newlines.
        '[\n  "https://app.example.com",\n  "http://localhost:5173"\n]',
        "https://app.example.com,http://localhost:5173",
        " https://app.example.com/ , http://localhost:5173/ ",
    ],
)
def test_cors_origins_accepts_json_and_plain_lists(
    value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A browser matches the Origin header exactly, so the value must survive
    the shapes an env var is realistically pasted in (see app/config.py)."""
    monkeypatch.setenv("CORS_ORIGINS", value)
    assert load_settings().cors_origins == [
        "https://app.example.com",
        "http://localhost:5173",
    ]


def test_cors_origins_accepts_a_single_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    assert load_settings().cors_origins == ["https://app.example.com"]


def test_cors_origins_defaults_to_local_dev(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert load_settings().cors_origins == ["http://localhost:5173"]


@pytest.mark.parametrize(
    "value",
    [
        '{"origin": "https://app.example.com"}',
        '"https://app.example.com"',
        "null",
        "true",
        "123",
    ],
)
def test_cors_origins_rejects_a_non_list_json_value(
    value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A JSON scalar would stringify into an origin no browser sends, silently
    blocking every request, so it has to fail loudly at startup instead."""
    monkeypatch.setenv("CORS_ORIGINS", value)
    with pytest.raises(ValueError):
        load_settings()


def test_engine_pool_follows_the_settings() -> None:
    """Supabase's Session Pooler allows 15 clients per project, shared by
    every backend on the database: the engine must keep to the cap the
    settings give it (see app/config.py)."""
    from app.config import settings
    from app.db.session import engine

    assert engine.pool.size() == settings.db_pool_size  # type: ignore[attr-defined]
    assert engine.pool._max_overflow == settings.db_max_overflow  # type: ignore[attr-defined]
    assert settings.db_pool_size + settings.db_max_overflow <= 7
