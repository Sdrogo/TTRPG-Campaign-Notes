import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

# Input guards: reject before decoding anything expensive.
MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_INPUT_PIXELS = 50_000_000
ALLOWED_INPUT_FORMATS = {"PNG", "JPEG", "WEBP", "GIF"}

# Output: every stored image is re-encoded, so a Document image is never
# larger than it needs to be to display (the feature spec: "if a file is
# too big we should scale it down"). Re-encoding also strips EXIF
# metadata such as GPS location from uploaded photos.
MAX_DIMENSION = 1920
OUTPUT_FORMAT = "WEBP"
OUTPUT_EXTENSION = ".webp"
OUTPUT_CONTENT_TYPE = "image/webp"
OUTPUT_QUALITY = 82

# Avatars are always shown as small circles, so they're cropped to a square
# and stored far smaller than a Document image.
AVATAR_DIMENSION = 512


class InvalidImageError(Exception):
    pass


class ImageTooLargeError(Exception):
    pass


@dataclass(frozen=True)
class NormalizedImage:
    data: bytes
    content_type: str
    extension: str
    width: int
    height: int


def normalize_image(
    data: bytes, max_dimension: int = MAX_DIMENSION, square: bool = False
) -> NormalizedImage:
    """Validates that `data` really is a supported image (by content, not
    by filename), downscales it so its longest side is at most
    `max_dimension`, and re-encodes it as WebP. With `square`, the image is
    first center-cropped to a square (avatars). Animated GIFs keep only
    their first frame."""
    if len(data) > MAX_INPUT_BYTES:
        raise ImageTooLargeError(
            f"Image exceeds the {MAX_INPUT_BYTES // (1024 * 1024)} MB upload limit"
        )

    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in ALLOWED_INPUT_FORMATS:
                raise InvalidImageError(f"Unsupported image format: {source.format}")
            if source.width * source.height > MAX_INPUT_PIXELS:
                raise ImageTooLargeError("Image dimensions are too large")

            image = ImageOps.exif_transpose(source)
            if square:
                side = min(image.width, image.height, max_dimension)
                image = ImageOps.fit(image, (side, side), Image.Resampling.LANCZOS)
            else:
                image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                has_alpha = image.mode in ("LA", "PA") or "transparency" in image.info
                image = image.convert("RGBA" if has_alpha else "RGB")

            output = io.BytesIO()
            image.save(output, format=OUTPUT_FORMAT, quality=OUTPUT_QUALITY, method=4)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise InvalidImageError("File is not a valid image") from exc

    return NormalizedImage(
        data=output.getvalue(),
        content_type=OUTPUT_CONTENT_TYPE,
        extension=OUTPUT_EXTENSION,
        width=image.width,
        height=image.height,
    )
