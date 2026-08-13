"""
Where an uploaded image goes.

One function, so no view knows whether it is writing to a local disk or to S3. In development
that is ``MEDIA_ROOT``; in production ``STORAGES["default"]`` is the S3 backend and the same
call lands in the bucket.

The path is derived from the record, never from the uploaded filename. A filename arrives from
a handset and can contain anything — ``../``, a null byte, another Mait's event id — and the
one thing it cannot be trusted to do is name a safe location.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import PurePosixPath

from django.core.files.storage import default_storage

ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def image_path(prefix: str, key: int | str, when: datetime, original_name: str) -> str:
    """`<prefix>/2026/08/<key>/<random>.jpg` — dated so a bucket stays browsable."""
    suffix = PurePosixPath(original_name or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        suffix = ".jpg"
    return f"{prefix}/{when.strftime('%Y/%m')}/{key}/{uuid.uuid4().hex}{suffix}"


def store_image(uploaded_file, *, prefix: str, key: int | str, when: datetime) -> str:
    """
    Write the file and return the URL to record on the row.

    Deliberately callable outside a transaction: an upload holds a connection for as long as
    the village network takes, and a transaction held open that long would block whatever row
    lock sits behind it (ADR 0002).
    """
    path = default_storage.save(image_path(prefix, key, when, uploaded_file.name), uploaded_file)
    return default_storage.url(path)
