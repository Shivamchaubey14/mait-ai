"""
Where a proof photo goes.

The mechanics live in ``apps.core.storage`` — an animal's portrait is written the same way and
the two must not drift apart. What is kept here is the one thing specific to this app: the
prefix a proof photo is filed under, and the event it is keyed to.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from apps.core.storage import image_path, store_image

PREFIX = "ai-photos"
THUMB_PREFIX = "ai-photos/thumbs"

# The thumbnail's longest edge and JPEG quality. Small enough to load a list of them on one bar,
# large enough to recognise the animal.
THUMB_MAX_EDGE = 320
THUMB_QUALITY = 80


@dataclass(frozen=True)
class StoredPhoto:
    """What storing a proof photo produced. The extras are empty when they could not be made."""

    url: str
    thumbnail_url: str
    checksum: str


def photo_path(event, original_name: str) -> str:
    """`ai-photos/2026/08/<event-id>/<random>.jpg`."""
    return image_path(PREFIX, event.id, event.created_at, original_name)


def store_photo(event, uploaded_file) -> str:
    """Write the photo and return the URL to record on the event."""
    return store_image(uploaded_file, prefix=PREFIX, key=event.id, when=event.created_at)


def store_photo_with_meta(event, uploaded_file) -> StoredPhoto:
    """
    Store the proof photo and, beside it, a checksum and a small thumbnail.

    Both extras are conveniences, never gates. If the bytes cannot be read a second time, or
    Pillow cannot decode the image, the original is still stored and returned and the extra
    fields come back empty — the proof is the photograph itself, and losing a thumbnail must
    never lose a capture. For that reason every step here is wrapped, and the original write is
    done exactly as ``store_photo`` has always done it.
    """
    checksum = _checksum(uploaded_file)

    # The original, written the same way as before — the one step that must not be caught.
    url = store_image(uploaded_file, prefix=PREFIX, key=event.id, when=event.created_at)

    thumbnail_url = ""
    try:
        thumbnail_url = _store_thumbnail(event, uploaded_file)
    except Exception:
        # A codec Pillow does not know, a truncated upload, storage that refused the second
        # write: the full photo is already saved, so the capture is safe. The thumbnail is left
        # empty and the portal falls back to the full image.
        thumbnail_url = ""

    return StoredPhoto(url=url, thumbnail_url=thumbnail_url, checksum=checksum)


def _checksum(uploaded_file) -> str:
    """SHA-256 of the uploaded bytes, read in chunks so a large photo is not held whole in RAM."""
    try:
        uploaded_file.seek(0)
        digest = hashlib.sha256()
        for chunk in uploaded_file.chunks():
            digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return ""
    finally:
        try:
            uploaded_file.seek(0)
        except Exception:
            pass


def _store_thumbnail(event, uploaded_file) -> str:
    """Decode, shrink to ``THUMB_MAX_EDGE`` on the long edge, and store as JPEG. Returns its URL."""
    from PIL import Image  # local: only this path needs Pillow, and it is optional work

    uploaded_file.seek(0)
    image = Image.open(uploaded_file)
    image = image.convert("RGB")
    image.thumbnail((THUMB_MAX_EDGE, THUMB_MAX_EDGE))

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=THUMB_QUALITY)
    buffer.seek(0)

    path = image_path(THUMB_PREFIX, event.id, event.created_at, "thumb.jpg")
    saved = default_storage.save(path, ContentFile(buffer.read()))
    try:
        uploaded_file.seek(0)
    except Exception:
        pass
    return default_storage.url(saved)
