"""
Field-level encryption for PII at rest (SRS §7 Security, §16).

Aadhaar, PAN and bank account numbers are encrypted with Fernet before they touch the
database. The key lives in the secret store as ``FIELD_ENCRYPTION_KEY`` and never in the
repository or the database.

Trade-off worth knowing before you use these: an encrypted column cannot be searched with a
SQL ``LIKE`` or matched with an index, because ciphertext for the same plaintext differs
between rows. If you need to look a record up by one of these values, store a separate
keyed hash column alongside and search that.
"""

from __future__ import annotations

import base64

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import models
from django.utils.functional import cached_property


class EncryptedFieldMixin:
    """Transparently encrypts on write and decrypts on read."""

    @cached_property
    def _fernet(self) -> Fernet:
        key = getattr(settings, "FIELD_ENCRYPTION_KEY", "")
        if not key:
            raise ImproperlyConfigured(
                "FIELD_ENCRYPTION_KEY is not set — PII fields cannot be read or written."
            )
        return Fernet(key.encode() if isinstance(key, str) else key)

    def get_prep_value(self, value):
        if value in (None, ""):
            return value
        return self._fernet.encrypt(str(value).encode()).decode()

    def from_db_value(self, value, expression, connection):
        if value in (None, ""):
            return value
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            # Wrong key, or a value written before encryption was enabled. Surfacing the
            # raw ciphertext would leak nothing useful and hide the misconfiguration, so
            # fail loudly instead.
            raise ValueError(
                f"Could not decrypt {self.model.__name__}.{self.name} — "
                "FIELD_ENCRYPTION_KEY may be wrong or rotated without re-encryption."
            ) from None


class EncryptedCharField(EncryptedFieldMixin, models.CharField):
    """CharField stored as Fernet ciphertext.

    ``max_length`` describes the plaintext. The column is widened automatically because
    ciphertext is substantially longer than its input.
    """

    def __init__(self, *args, **kwargs):
        plaintext_length = kwargs.get("max_length", 100)
        kwargs["max_length"] = base64.urlsafe_b64encode(
            b"x" * (plaintext_length + 100)
        ).decode().__len__()
        super().__init__(*args, **kwargs)


def mask(value: str | None, visible: int = 4) -> str:
    """
    Mask a PII value for display, keeping only the trailing characters.

    This is what standard API responses return (SRS §16). Full values come only from the
    restricted, audit-logged admin endpoint.

    >>> mask("123456789012")
    'XXXXXXXX9012'
    """
    if not value:
        return ""
    if len(value) <= visible:
        return "X" * len(value)
    return "X" * (len(value) - visible) + value[-visible:]
