"""The OAuth providers people sign in with (ticket 73 step 3): where to send
them, how to trade the returned code for a token, and how to read who they
are. Plain OAuth 2.0 authorization-code flow with a client secret; PKCE
(S256) on top where the provider supports it."""

import base64
import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import settings

_TIMEOUT = 15.0


class ProviderError(Exception):
    """The provider refused the code or answered with something unusable."""


@dataclass(frozen=True)
class ProviderIdentity:
    """Who the provider says signed in. `provider_user_id` is the stable id
    Supabase also stored, so migrated accounts match."""

    provider_user_id: str
    email: str | None
    email_verified: bool
    name: str | None
    picture: str | None


@dataclass(frozen=True)
class Provider:
    """One provider's endpoints and settings."""

    id: str
    authorize_url: str
    token_url: str
    scope: str
    pkce: bool
    client_id: Callable[[], str]
    client_secret: Callable[[], str]

    @property
    def enabled(self) -> bool:
        """Offered only when its OAuth app is configured."""
        return bool(self.client_id() and self.client_secret())

    def callback_url(self) -> str:
        """The redirect URI registered in the provider's console."""
        return f"{settings.api_public_url.rstrip('/')}/auth/{self.id}/callback"

    def authorization_url(self, state: str, code_verifier: str) -> str:
        """Where the browser goes to sign in with this provider."""
        params = {
            "client_id": self.client_id(),
            "redirect_uri": self.callback_url(),
            "response_type": "code",
            "scope": self.scope,
            "state": state,
        }
        if self.pkce:
            params["code_challenge"] = code_challenge(code_verifier)
            params["code_challenge_method"] = "S256"
        return f"{self.authorize_url}?{urlencode(params)}"


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def google_identity(profile: dict[str, Any], _emails: list[Any]) -> ProviderIdentity:
    """Google's OpenID Connect userinfo."""
    return ProviderIdentity(
        provider_user_id=str(profile["sub"]),
        email=_text(profile.get("email")),
        email_verified=profile.get("email_verified") is True,
        name=_text(profile.get("name")),
        picture=_text(profile.get("picture")),
    )


def discord_identity(profile: dict[str, Any], _emails: list[Any]) -> ProviderIdentity:
    """Discord's `/users/@me`. The display name falls back to the username;
    the avatar is a hash to turn into a CDN address."""
    user_id = str(profile["id"])
    avatar = _text(profile.get("avatar"))
    return ProviderIdentity(
        provider_user_id=user_id,
        email=_text(profile.get("email")),
        email_verified=profile.get("verified") is True,
        name=_text(profile.get("global_name")) or _text(profile.get("username")),
        picture=f"https://cdn.discordapp.com/avatars/{user_id}/{avatar}.png" if avatar else None,
    )


def github_identity(profile: dict[str, Any], emails: list[Any]) -> ProviderIdentity:
    """GitHub's `/user`, with the email from `/user/emails`: the primary one
    if verified, the public profile email (unverified) otherwise."""
    primary = next(
        (
            entry
            for entry in emails
            if isinstance(entry, dict) and entry.get("primary") and _text(entry.get("email"))
        ),
        None,
    )
    if primary is not None:
        email, verified = _text(primary.get("email")), primary.get("verified") is True
    else:
        email, verified = _text(profile.get("email")), False
    return ProviderIdentity(
        provider_user_id=str(profile["id"]),
        email=email,
        email_verified=verified,
        name=_text(profile.get("name")) or _text(profile.get("login")),
        picture=_text(profile.get("avatar_url")),
    )


@dataclass(frozen=True)
class _Profile:
    url: str
    emails_url: str | None
    read: Callable[[dict[str, Any], list[Any]], ProviderIdentity]


PROVIDERS: dict[str, Provider] = {
    "google": Provider(
        id="google",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        scope="openid email profile",
        pkce=True,
        client_id=lambda: settings.google_client_id,
        client_secret=lambda: settings.google_client_secret,
    ),
    "discord": Provider(
        id="discord",
        authorize_url="https://discord.com/oauth2/authorize",
        token_url="https://discord.com/api/oauth2/token",
        scope="identify email",
        pkce=False,
        client_id=lambda: settings.discord_client_id,
        client_secret=lambda: settings.discord_client_secret,
    ),
    "github": Provider(
        id="github",
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        scope="read:user user:email",
        pkce=True,
        client_id=lambda: settings.github_client_id,
        client_secret=lambda: settings.github_client_secret,
    ),
}

_PROFILES: dict[str, _Profile] = {
    "google": _Profile("https://openidconnect.googleapis.com/v1/userinfo", None, google_identity),
    "discord": _Profile("https://discord.com/api/users/@me", None, discord_identity),
    "github": _Profile(
        "https://api.github.com/user", "https://api.github.com/user/emails", github_identity
    ),
}


def new_code_verifier() -> str:
    """A PKCE code verifier (RFC 7636: 43 to 128 characters)."""
    return secrets.token_urlsafe(48)


def code_challenge(verifier: str) -> str:
    """The S256 challenge for `verifier`."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def http_client() -> httpx.AsyncClient:
    """The client for provider calls; tests swap in a mock transport."""
    return httpx.AsyncClient(timeout=_TIMEOUT)


async def fetch_identity(provider: Provider, code: str, code_verifier: str) -> ProviderIdentity:
    """Trades the authorization `code` for an access token, then reads the
    profile with it. Raises `ProviderError` on any refusal."""
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": provider.callback_url(),
        "client_id": provider.client_id(),
        "client_secret": provider.client_secret(),
    }
    if provider.pkce:
        form["code_verifier"] = code_verifier
    profile_spec = _PROFILES[provider.id]
    try:
        async with http_client() as client:
            token_response = await client.post(
                provider.token_url, data=form, headers={"Accept": "application/json"}
            )
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise ProviderError(f"{provider.id}: no access token")
            headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
            profile_response = await client.get(profile_spec.url, headers=headers)
            profile_response.raise_for_status()
            profile = profile_response.json()
            emails: list[Any] = []
            if profile_spec.emails_url is not None:
                emails_response = await client.get(profile_spec.emails_url, headers=headers)
                if emails_response.is_success and isinstance(emails_response.json(), list):
                    emails = emails_response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError(f"{provider.id}: {exc}") from exc
    if not isinstance(profile, dict):
        raise ProviderError(f"{provider.id}: unexpected profile")
    try:
        return profile_spec.read(profile, emails)
    except KeyError as exc:
        raise ProviderError(f"{provider.id}: profile without id") from exc
