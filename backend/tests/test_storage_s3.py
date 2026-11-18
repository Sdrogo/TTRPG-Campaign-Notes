"""The bucket on S3 (ticket 73 step 4, Garage): request signing, presigned
links, and where each storage call goes. The HTTP itself is
checked live against Garage (context/architecture.md)."""

from collections.abc import Mapping
from urllib.parse import parse_qs, urlsplit

import pytest

from app.config import settings
from app.db import storage

PUBLIC = "https://files.example.test"


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "s3_endpoint", "http://garage:3900")
    monkeypatch.setattr(settings, "s3_public_url", PUBLIC)
    monkeypatch.setattr(settings, "s3_region", "garage")
    monkeypatch.setattr(settings, "s3_access_key_id", "GKtestkey")
    monkeypatch.setattr(settings, "s3_secret_access_key", "testsecret")
    monkeypatch.setattr(settings, "storage_bucket", "document-images")
    monkeypatch.setattr(storage, "LEGACY_SUPABASE_URLS", ("https://own.supabase.test",))


def query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query)


def test_requests_are_signed_for_the_internal_endpoint(s3: None) -> None:
    headers = storage.s3_signed_headers(
        "PUT", "r/a b.webp", b"data", {"Content-Type": "image/webp"}
    )

    assert headers["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=GKtestkey/")
    assert "/garage/s3/aws4_request" in headers["Authorization"]
    # S3 checks the body against its signed hash.
    assert headers["X-Amz-Content-SHA256"] != "UNSIGNED-PAYLOAD"
    assert headers["Content-Type"] == "image/webp"


def test_a_presigned_link_is_on_the_public_host_path_style(s3: None) -> None:
    url = storage.s3_presigned_url("r/d/a b.webp", 3600)

    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}" == PUBLIC
    assert parts.path == "/document-images/r/d/a%20b.webp"
    params = query(url)
    assert params["X-Amz-Expires"] == ["3600"]
    assert params["X-Amz-SignedHeaders"] == ["host"]
    assert "response-content-disposition" not in params


def test_a_download_link_carries_the_signed_attachment_name(s3: None) -> None:
    url = storage.s3_presigned_url("r/f.pdf", 600, download_name="Mappa città.pdf")

    params = query(url)
    assert params["response-content-disposition"] == [
        "attachment; filename=\"Mappa citt_.pdf\"; filename*=UTF-8''Mappa%20citt%C3%A0.pdf"
    ]
    assert params["X-Amz-Expires"] == ["600"]


def test_the_ascii_name_drops_quotes_and_backslashes() -> None:
    assert storage.content_disposition('a"b\\c.pdf') == (
        "attachment; filename=\"a_b_c.pdf\"; filename*=UTF-8''a%22b%5Cc.pdf"
    )


async def test_s3_links_are_signed_without_a_request(s3: None) -> None:
    urls = await storage.create_signed_urls(["a.webp", "b.webp"], 3600)

    assert set(urls) == {"a.webp", "b.webp"}
    assert all(url.startswith(f"{PUBLIC}/document-images/") for url in urls.values())


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (f"{PUBLIC}/document-images/r/d/a%20b.webp?X-Amz-Signature=x", "r/d/a b.webp"),
        (f"{PUBLIC}/other-bucket/r/d/a.webp?X-Amz-Signature=x", None),
        (f"{PUBLIC}/document-images/", None),
        (f"{PUBLIC}/document-images/r/../x.webp", None),
        # A link made before the move still counts: the object kept its path.
        (
            "https://own.supabase.test/storage/v1/object/sign/document-images/r/a.webp?token=t",
            "r/a.webp",
        ),
        ("https://elsewhere.test/document-images/r/a.webp", None),
    ],
)
def test_own_object_path_reads_both_link_shapes(s3: None, url: str, expected: str | None) -> None:
    assert storage.own_object_path(url) == expected


def test_a_download_link_is_a_signed_attachment(s3: None) -> None:
    url = storage.as_download("r/f.pdf", "f.pdf")

    assert urlsplit(url).path == "/document-images/r/f.pdf"
    assert query(url)["response-content-disposition"] == [
        "attachment; filename=\"f.pdf\"; filename*=UTF-8''f.pdf"
    ]


class Calls:
    """Records which side each storage call reached."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.seen: list[tuple[object, ...]] = []

        async def s3_upload(path: str, data: bytes, content_type: str) -> None:
            self.seen.append(("s3_upload", path))

        async def s3_remove(path: str) -> None:
            self.seen.append(("s3_remove", path))

        async def read_limited(url: str, headers: Mapping[str, str], max_bytes: int) -> bytes:
            self.seen.append(("read", url, "Authorization" in headers))
            return b"bytes"

        monkeypatch.setattr(storage, "_s3_upload", s3_upload)
        monkeypatch.setattr(storage, "_s3_remove", s3_remove)
        monkeypatch.setattr(storage, "_read_limited", read_limited)


async def test_calls_go_to_s3(s3: None, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = Calls(monkeypatch)

    await storage.upload("p", b"x", "image/webp")
    await storage.remove("p")
    assert await storage.download("r/a b.webp", 10) == b"bytes"

    assert calls.seen == [
        ("s3_upload", "p"),
        ("s3_remove", "p"),
        ("read", "http://garage:3900/document-images/r/a%20b.webp", True),
    ]


async def test_the_pdf_job_reads_own_links_inside_the_server(
    s3: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = Calls(monkeypatch)

    await storage.download_signed(storage.s3_presigned_url("r/a.webp", 60), 10)
    await storage.download_signed("https://elsewhere.test/a.webp", 10)

    assert calls.seen == [
        ("read", "http://garage:3900/document-images/r/a.webp", True),
        ("read", "https://elsewhere.test/a.webp", False),
    ]
