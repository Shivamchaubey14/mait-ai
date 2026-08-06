"""
Where a proof photo goes.

One function, so the view never knows whether it is writing to a local disk or to S3. In
development that is `MEDIA_ROOT`; in production `STORAGES["default"]` is the S3 backend and
the same call lands in the bucket (SRS §6.3 step 5).

The path is derived from the event, never from the uploaded filename. A filename arrives from
a handset and can contain anything — `../`, a null byte, another Mait's event id — and the
one thing it cannot be trusted to do is name a safe location.
"""

from __future__ import annotations

import uuid
from pathlib import PurePosixPath

from django.core.files.storage import default_storage


def photo_path(event, original_name: str) -> str:
    """`ai-photos/2026/08/<event-id>/<random>.jpg` — dated so a bucket stays browsable."""
    suffix = PurePosixPath(original_name or "").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    stamp = event.created_at.strftime("%Y/%m")
    return f"ai-photos/{stamp}/{event.id}/{uuid.uuid4().hex}{suffix}"


def store_photo(event, uploaded_file) -> str:
    """
    Write the photo and return the URL to record on the event.

    Deliberately outside the completion transaction: an upload holds a connection for as long
    as the network takes, and a transaction held open that long would block the inventory row
    lock behind it (ADR 0002).
    """
    path = default_storage.save(photo_path(event, uploaded_file.name), uploaded_file)
    return default_storage.url(path)
