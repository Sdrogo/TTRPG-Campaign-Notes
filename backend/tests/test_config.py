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


def test_db_pool_defaults_stay_small(monkeypatch: pytest.MonkeyPatch) -> None:
    """Small enough that two backends together stay far below Postgres's
    default of 100 connections (see app/config.py)."""
    monkeypatch.delenv("DB_POOL_SIZE", raising=False)
    monkeypatch.delenv("DB_MAX_OVERFLOW", raising=False)
    settings = load_settings()
    assert (settings.db_pool_size, settings.db_max_overflow) == (5, 2)
    assert 2 * (settings.db_pool_size + settings.db_max_overflow) <= 15


def test_engine_pool_follows_the_settings() -> None:
    """The engine is built with the configured pool, not SQLAlchemy's default
    of 5 + 10 (app/db/session.py)."""
    from app.config import settings
    from app.db.session import engine

    assert engine.pool.size() == settings.db_pool_size  # type: ignore[attr-defined]


def test_s3_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    assert load_settings().s3_endpoint == ""


def test_an_s3_endpoint_needs_its_public_host_and_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without them the first upload or image would fail; startup does instead."""
    monkeypatch.setenv("S3_ENDPOINT", "http://garage:3900")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "GKkey")
    monkeypatch.delenv("S3_PUBLIC_URL", raising=False)
    monkeypatch.delenv("S3_SECRET_ACCESS_KEY", raising=False)

    with pytest.raises(ValueError, match="S3_PUBLIC_URL, S3_SECRET_ACCESS_KEY"):
        load_settings()


def test_a_complete_s3_setting_loads(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("S3_ENDPOINT", "http://garage:3900")
    monkeypatch.setenv("S3_PUBLIC_URL", "https://files.example.test")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "GKkey")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "secret")

    loaded = load_settings()

    assert loaded.s3_endpoint == "http://garage:3900"
    assert loaded.s3_region == "garage"
