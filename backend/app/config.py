"""Runtime settings, read from the environment (or a local `.env`)."""

import json
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Every setting the backend reads. Defaults suit local development;
    production sets them in the hosting dashboard."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    storage_bucket: str = "document-images"
    # The images bucket on S3 (ticket 73 step 4: Garage on the VPS).
    # `s3_endpoint` is where the backend talks to
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
    database_url: str = ""
    # Connections this process may hold: the server's Postgres (ticket 73
    # step 5) allows 100, so 5 + 2 leaves room for migrations and backups.
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
