"""Runtime settings, read from the environment (or a local `.env`)."""

import json
import re
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Every setting the backend reads. Defaults suit local development;
    production sets them in the hosting dashboard."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase Storage only (the images bucket); sign-in left Supabase in
    # ticket 73 step 3. Still read once the bucket is on S3: by the copy
    # (`python -m app.storage_copy`), by old links in exports, and for a
    # rollback.
    supabase_url: str = ""
    supabase_secret_key: str = ""
    storage_bucket: str = "document-images"
    # The bucket on S3 (ticket 73 step 4: Garage on the VPS). Set, it
    # replaces Supabase Storage. `s3_endpoint` is where the backend talks to
    # it (`http://garage:3900`, inside the compose network);
    # `s3_public_url` is the host browsers fetch signed links from
    # (`https://files.exlibris.world`, through Caddy).
    s3_endpoint: str = ""
    s3_public_url: str = ""
    s3_region: str = "garage"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    # NoDecode: parsed by `_parse_cors_origins` below instead of as JSON, so
    # a plain or comma-separated value from a hosting dashboard also works.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    # Origins allowed by pattern on top of `cors_origins`, for hosts that are
    # generated per deploy (Vercel previews). Matched against the whole
    # Origin header (Starlette uses `fullmatch`). Unset = no pattern.
    cors_origin_regex: str | None = None
    database_url: str = ""
    # Connections this process may hold. Supabase's Session Pooler allows 15
    # clients per project in total, shared by every backend on the same
    # database (two at once while production moves host), so 5 + 2 each
    # keeps two processes under the cap.
    db_pool_size: int = 5
    db_max_overflow: int = 2
    # FastAPI's /docs, /redoc and /openapi.json (spec 72 Decision 8): off
    # unless asked for, so production and staging don't publish the route map.
    api_docs_enabled: bool = False
    # Openverse API credentials for the image search (spec 29). Unset, the
    # search calls Openverse anonymously, under its lower rate limits.
    openverse_client_id: str = ""
    openverse_client_secret: str = ""
    # Sign-in (ticket 73 step 3): the backend runs the OAuth flow itself.
    # The API's public address, which the providers send users back to
    # (`<api_public_url>/auth/<provider>/callback`, registered in each
    # provider's console).
    api_public_url: str = "http://localhost:8000"
    # Signs the access tokens and the short sign-in cookie (HS256). At least
    # 32 characters, random (`openssl rand -base64 48`); changing it signs
    # everyone out of their current access token, not of their session.
    auth_token_secret: str = ""
    # The refresh-token cookie is `Secure`; off only for plain-HTTP setups
    # other than localhost (browsers accept Secure cookies on localhost).
    auth_cookie_secure: bool = True
    # Each provider's OAuth app. A provider with no client id is not offered:
    # its sign-in route answers 404.
    google_client_id: str = ""
    google_client_secret: str = ""
    discord_client_id: str = ""
    discord_client_secret: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""
    # Who sees the Admin page (ticket 75): user ids, comma-separated. Empty
    # means nobody; the page and its API then answer 404 to everyone.
    admin_user_ids: Annotated[list[str], NoDecode] = []
    # The nightly backup's status file (ticket 75 Decision 6), mounted
    # read-only from the server: backup.sh writes the time of its last good
    # run there. Unset (servers without a backup): `/health/backup` is 404.
    backup_status_file: str = ""
    # Older than this, `/health/backup` answers 503 and the uptime monitor
    # alerts: a night's run plus some slack.
    backup_max_age_hours: int = 26

    @model_validator(mode="after")
    def _check_s3(self) -> "Settings":
        """An S3 endpoint without its public host or key would only fail on
        the first upload or image: refuse to start instead."""
        if self.s3_endpoint:
            missing = [
                name.upper()
                for name in ("s3_public_url", "s3_access_key_id", "s3_secret_access_key")
                if not getattr(self, name)
            ]
            if missing:
                raise ValueError(f"S3_ENDPOINT is set but {', '.join(missing)} is not")
        return self

    @field_validator("cors_origin_regex", mode="before")
    @classmethod
    def _check_cors_origin_regex(cls, value: object) -> object:
        """Blank means unset, and a pattern that doesn't compile fails at
        startup - Starlette would otherwise raise only once the middleware
        is built, with no hint that the env var is to blame."""
        if not isinstance(value, str):
            return value
        pattern = value.strip()
        if not pattern:
            return None
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(f"CORS_ORIGIN_REGEX is not a valid regex: {exc}") from exc
        return pattern

    @field_validator("admin_user_ids", mode="before")
    @classmethod
    def _parse_admin_user_ids(cls, value: object) -> object:
        """A comma-separated list of user ids, blanks dropped."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: object) -> object:
        """Accepts a JSON list (`["https://a","https://b"]`), a comma-separated
        list, or a single origin, and normalizes each entry. A browser matches
        the `Origin` header exactly, so a stray space, newline or trailing
        slash pasted into an env var would silently block every request."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("{"):
                raise ValueError("CORS_ORIGINS must be a list of origins, not an object")
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                # Not JSON at all: a plain or comma-separated value.
                items: list[object] = list(text.split(","))
            else:
                # A bare JSON scalar (`"https://a"`, `null`, `123`) would keep
                # its quotes or stringify into an origin no browser can match,
                # so reject it instead of silently blocking every request.
                if not isinstance(parsed, list):
                    raise ValueError("CORS_ORIGINS must be a list of origins")
                items = list(parsed)
        elif isinstance(value, list):
            items = list(value)
        else:
            return value

        return [origin for origin in (str(item).strip().rstrip("/") for item in items) if origin]


settings = Settings()
