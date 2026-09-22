import json
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_secret_key: str = ""
    storage_bucket: str = "document-images"
    # NoDecode: parsed by `_parse_cors_origins` below instead of as JSON, so
    # a plain or comma-separated value from a hosting dashboard also works.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    database_url: str = ""

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
            if text.startswith("["):
                parsed = json.loads(text)
                if not isinstance(parsed, list):
                    raise ValueError("CORS_ORIGINS must be a list of origins")
                items: list[object] = list(parsed)
            else:
                items = list(text.split(","))
        elif isinstance(value, list):
            items = list(value)
        else:
            return value

        return [origin for origin in (str(item).strip().rstrip("/") for item in items) if origin]

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def supabase_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


settings = Settings()
