"""
Regression: ``_drop_nullish_gps`` must not deep-copy the uploaded photo (SRS §9.6).

``QueryDict.copy()`` deep-copies every value. A real proof photo arrives as a
``TemporaryUploadedFile`` — an open file handle — once it exceeds the in-memory upload
threshold (~2.5 MB), and an open file cannot be deep-copied. So the old ``data.copy()`` raised
an uncaught 500 on every photo upload from a phone, which the client read as a transient 5xx
and re-queued forever. The existing HTTP tests missed it because their fixture photo is a few
hundred bytes and stays in memory, where deep-copy happens to work. These guard the real path
with a value that refuses to be deep-copied, exactly as a temp-file upload does.
"""

from __future__ import annotations

from django.http import QueryDict

from apps.ai_events.views import _drop_nullish_gps


class _UndeepcopyableFile:
    """Stands in for ``TemporaryUploadedFile``: a value that refuses to be deep-copied."""

    def __deepcopy__(self, memo):
        raise TypeError("an uploaded file cannot be deep-copied")


def _multipart(photo, **fields) -> QueryDict:
    data = QueryDict(mutable=True)
    data.setlist("photo", [photo])
    for key, value in fields.items():
        data[key] = value
    return data


def test_a_real_gps_fix_survives_and_the_upload_is_not_copied():
    photo = _UndeepcopyableFile()
    cleaned = _drop_nullish_gps(_multipart(photo, gps_lat="28.3670000", gps_lng="79.4304000"))

    # The file is the *same* object, carried by reference rather than deep-copied.
    assert cleaned["photo"] is photo
    assert cleaned["gps_lat"] == "28.3670000"
    assert cleaned["gps_lng"] == "79.4304000"


def test_nullish_gps_is_dropped_without_touching_the_upload():
    photo = _UndeepcopyableFile()
    cleaned = _drop_nullish_gps(_multipart(photo, gps_lat="null", gps_lng=""))

    assert cleaned["photo"] is photo
    assert "gps_lat" not in cleaned
    assert "gps_lng" not in cleaned


def test_a_plain_dict_is_still_handled():
    # A JSON request or a test fixture may pass a plain dict; the shallow branch must cope.
    cleaned = _drop_nullish_gps({"gps_lat": "undefined", "performed_at": "2026-11-05T10:00:00Z"})

    assert "gps_lat" not in cleaned
    assert cleaned["performed_at"] == "2026-11-05T10:00:00Z"
