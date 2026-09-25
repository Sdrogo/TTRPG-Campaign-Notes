import asyncio
import socket

import httpx
import pytest
import pytest_asyncio

from app.db.remote_images import RemoteImageError, fetch_image_bytes


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/image.png",
        "http://127.0.0.1/image.png",
        "http://localhost:8000/image.png",
        "http://10.0.0.5/image.png",
        "http://192.168.1.10/image.png",
        # Cloud metadata endpoint (link-local).
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/image.png",
    ],
)
async def test_non_public_urls_are_refused_before_any_request(url: str) -> None:
    with pytest.raises(RemoteImageError):
        await fetch_image_bytes(url)


class _FakeResolver:
    """Stands in for DNS: answers each lookup with the next address in
    `answers` (the last one repeats), counting how often it was asked."""

    def __init__(self, *answers: str) -> None:
        self.answers = list(answers)
        self.calls: list[str] = []

    async def getaddrinfo(self, host: str, port: object, **kwargs: object) -> list[object]:
        self.calls.append(host)
        address = self.answers[min(len(self.calls), len(self.answers)) - 1]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0))]


@pytest_asyncio.fixture
async def resolver(monkeypatch: pytest.MonkeyPatch) -> _FakeResolver:
    fake = _FakeResolver("93.184.216.34")
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(loop, "getaddrinfo", fake.getaddrinfo)
    return fake


async def test_connection_is_pinned_to_the_validated_address(resolver: _FakeResolver) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"image-bytes")

    data = await fetch_image_bytes(
        "https://images.example.com/cat.png", transport=httpx.MockTransport(handler)
    )

    assert data == b"image-bytes"
    request = seen[0]
    assert request.url.host == "93.184.216.34"
    assert request.headers["Host"] == "images.example.com"
    # TLS still verifies the certificate against the original name.
    assert request.extensions["sni_hostname"] == "images.example.com"
    assert resolver.calls == ["images.example.com"]


async def test_rebinding_to_a_private_address_is_never_connected_to(
    resolver: _FakeResolver,
) -> None:
    # Public on the first lookup, loopback on any later one: with pinning
    # there is no later lookup, so the loopback answer is never used.
    resolver.answers = ["93.184.216.34", "127.0.0.1"]
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return httpx.Response(200, content=b"ok")

    await fetch_image_bytes(
        "http://rebind.example.com/x.png", transport=httpx.MockTransport(handler)
    )
    assert hosts == ["93.184.216.34"]
    assert len(resolver.calls) == 1


async def test_each_redirect_hop_is_resolved_and_pinned_again(resolver: _FakeResolver) -> None:
    resolver.answers = ["93.184.216.34", "127.0.0.1"]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://internal.example.com/secret"})

    with pytest.raises(RemoteImageError) as exc_info:
        await fetch_image_bytes(
            "http://public.example.com/x.png", transport=httpx.MockTransport(handler)
        )
    assert exc_info.value.key == "errors.image.remoteNonPublic"
    assert resolver.calls == ["public.example.com", "internal.example.com"]
