"""
Where a proof photo goes.

The mechanics live in ``apps.core.storage`` — an animal's portrait is written the same way and
the two must not drift apart. What is kept here is the one thing specific to this app: the
prefix a proof photo is filed under, and the event it is keyed to.
"""

from __future__ import annotations

from apps.core.storage import image_path, store_image

PREFIX = "ai-photos"


def photo_path(event, original_name: str) -> str:
    """`ai-photos/2026/08/<event-id>/<random>.jpg`."""
    return image_path(PREFIX, event.id, event.created_at, original_name)


def store_photo(event, uploaded_file) -> str:
    """Write the photo and return the URL to record on the event."""
    return store_image(uploaded_file, prefix=PREFIX, key=event.id, when=event.created_at)
