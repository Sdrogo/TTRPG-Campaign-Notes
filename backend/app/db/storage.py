import httpx

from app.config import settings


class StorageError(Exception):
    pass


def _headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }


def _object_url(path: str) -> str:
    return f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{path}"


async def upload(path: str, data: bytes, content_type: str) -> None:
    """Server-side upload with the backend's secret key: the client never
    touches Storage itself (architecture.md, Invariant 2), and only bytes
    that already went through `app/domain/images.normalize_image` land in
    the bucket."""
    headers = {**_headers(), "Content-Type": content_type, "x-upsert": "false"}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(_object_url(path), headers=headers, content=data)
    if response.is_error:
        raise StorageError(f"Failed to upload {path}: {response.text}")


async def remove(path: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.delete(_object_url(path), headers=_headers())
    # A 404 means the object is already gone, which is the state we want.
    if response.is_error and response.status_code != 404:
        raise StorageError(f"Failed to delete {path}: {response.text}")


def public_url(path: str) -> str:
    return f"{settings.supabase_url}/storage/v1/object/public/{settings.storage_bucket}/{path}"
