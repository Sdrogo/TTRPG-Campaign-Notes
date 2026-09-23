"""Fetching an image from a user-supplied URL, guarded against SSRF: only
public addresses, a bounded number of redirects, a size cap enforced while
streaming, and a connection pinned to the address that was checked."""

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin

import httpx

from app.domain.images import MAX_INPUT_BYTES

MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


class RemoteImageError(Exception):
    """The URL can't be fetched safely, or didn't return an image within the
    limits. The message is safe to show to the user."""


async def _resolve_public_address(url: httpx.URL) -> IPAddress:
    """SSRF guard: the backend fetches user-supplied URLs, so refuse
    anything that isn't plain http(s) to a publicly routable address
    (no localhost, private LAN, link-local/cloud-metadata, ...). Checked
    again on every redirect hop.

    Returns the address the request must then connect to. The caller pins
    the connection to it instead of letting httpx resolve the host a
    second time, which a short-TTL DNS record could answer differently
    (DNS rebinding)."""
    if url.scheme not in ("http", "https") or not url.raw_host:
        raise RemoteImageError("Only http(s) image URLs are supported")

    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            url.raw_host.decode("ascii"), url.port, type=socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise RemoteImageError("Could not resolve the image URL's host") from exc

    addresses: list[IPAddress] = []
    for info in infos:
        # Strip an IPv6 zone id ("fe80::1%eth0"), which ip_address rejects.
        address = ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
        if not address.is_global:
            raise RemoteImageError("Image URL points to a non-public address")
        addresses.append(address)
    if not addresses:
        raise RemoteImageError("Could not resolve the image URL's host")
    return addresses[0]


def _pinned_request(
    client: httpx.AsyncClient, url: httpx.URL, address: IPAddress, headers: dict[str, str]
) -> httpx.Request:
    """A GET to `address` that still presents itself as `url`'s host: the
    Host header carries the original name, and for HTTPS so does SNI -
    httpcore verifies the certificate against the SNI name, so TLS checks
    are unchanged."""
    hostname = url.raw_host.decode("ascii")
    host_header = hostname if url.port is None else f"{hostname}:{url.port}"
    extensions = {"sni_hostname": hostname} if url.scheme == "https" else {}
    return client.build_request(
        "GET",
        url.copy_with(host=str(address)),
        headers={**headers, "Host": host_header},
        extensions=extensions,
    )


async def fetch_image_bytes(url: str, transport: httpx.AsyncBaseTransport | None = None) -> bytes:
    """Downloads the image at `url`, following at most `MAX_REDIRECTS`
    redirects and validating each hop again. The bytes are not yet checked to
    be an image - that's `normalize_image`'s job. `transport` is for tests."""
    headers = {"User-Agent": "TTRPG-Campaign-Notes/0.1 (image import)", "Accept": "image/*"}
    async with httpx.AsyncClient(
        timeout=TIMEOUT_SECONDS, follow_redirects=False, transport=transport
    ) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            try:
                parsed = httpx.URL(current)
            except httpx.InvalidURL as exc:
                raise RemoteImageError("Only http(s) image URLs are supported") from exc
            address = await _resolve_public_address(parsed)
            request = _pinned_request(client, parsed, address, headers)
            try:
                response = await client.send(request, stream=True)
                try:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise RemoteImageError("Image URL redirected without a location")
                        # Resolved against the original URL, not the pinned
                        # IP one, so the next hop is validated by name again.
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
                finally:
                    await response.aclose()
            except httpx.HTTPError as exc:
                raise RemoteImageError("Could not download the image URL") from exc
    raise RemoteImageError("Image URL redirected too many times")
