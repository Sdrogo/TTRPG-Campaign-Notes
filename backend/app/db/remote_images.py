import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from app.domain.images import MAX_INPUT_BYTES

MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10


class RemoteImageError(Exception):
    pass


async def _ensure_public_host(url: str) -> None:
    """SSRF guard: the backend fetches user-supplied URLs, so refuse
    anything that isn't plain http(s) to a publicly routable address
    (no localhost, private LAN, link-local/cloud-metadata, ...). Checked
    again on every redirect hop."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise RemoteImageError("Only http(s) image URLs are supported")

    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            parts.hostname, parts.port, type=socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise RemoteImageError("Could not resolve the image URL's host") from exc

    for info in infos:
        # Strip an IPv6 zone id ("fe80::1%eth0"), which ip_address rejects.
        address = ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
        if not address.is_global:
            raise RemoteImageError("Image URL points to a non-public address")


async def fetch_image_bytes(url: str) -> bytes:
    headers = {"User-Agent": "TTRPG-Campaign-Notes/0.1 (image import)", "Accept": "image/*"}
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            await _ensure_public_host(current)
            try:
                async with client.stream("GET", current, headers=headers) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise RemoteImageError("Image URL redirected without a location")
                        current = urljoin(current, location)
                        continue
                    if response.is_error:
                        raise RemoteImageError(f"Image URL returned HTTP {response.status_code}")

                    chunks: list[bytes] = []
                    received = 0
                    async for chunk in response.aiter_bytes():
                        received += len(chunk)
                        if received > MAX_INPUT_BYTES:
                            raise RemoteImageError("Image at URL is too large")
                        chunks.append(chunk)
                    return b"".join(chunks)
            except httpx.HTTPError as exc:
                raise RemoteImageError("Could not download the image URL") from exc
    raise RemoteImageError("Image URL redirected too many times")
