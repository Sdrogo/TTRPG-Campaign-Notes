import pytest

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
