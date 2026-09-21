import io

import pytest
from PIL import Image

from app.domain.images import (
    MAX_DIMENSION,
    MAX_INPUT_BYTES,
    ImageTooLargeError,
    InvalidImageError,
    normalize_image,
)


def _encode(size: tuple[int, int], image_format: str, mode: str = "RGB") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, color=0).save(buffer, format=image_format)
    return buffer.getvalue()


def _decode(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def test_large_image_is_scaled_down_to_the_max_dimension() -> None:
    result = normalize_image(_encode((4000, 2000), "PNG"))

    assert (result.width, result.height) == (MAX_DIMENSION, MAX_DIMENSION // 2)
    decoded = _decode(result.data)
    assert decoded.format == "WEBP"
    assert decoded.size == (MAX_DIMENSION, MAX_DIMENSION // 2)


def test_small_image_keeps_its_size_but_is_reencoded() -> None:
    result = normalize_image(_encode((300, 200), "JPEG"))

    assert (result.width, result.height) == (300, 200)
    assert result.content_type == "image/webp"
    assert result.extension == ".webp"


def test_transparency_is_preserved() -> None:
    result = normalize_image(_encode((64, 64), "PNG", mode="RGBA"))
    assert _decode(result.data).mode == "RGBA"


def test_palette_gif_is_accepted() -> None:
    result = normalize_image(_encode((64, 64), "GIF", mode="P"))
    assert _decode(result.data).format == "WEBP"


def test_non_image_bytes_are_rejected() -> None:
    with pytest.raises(InvalidImageError):
        normalize_image(b"%PDF-1.7 definitely not an image")


def test_unsupported_image_format_is_rejected() -> None:
    with pytest.raises(InvalidImageError):
        normalize_image(_encode((10, 10), "BMP"))


def test_oversized_input_is_rejected_before_decoding() -> None:
    with pytest.raises(ImageTooLargeError):
        normalize_image(b"\0" * (MAX_INPUT_BYTES + 1))
