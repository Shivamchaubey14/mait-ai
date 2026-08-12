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
import hashlib
import hmac

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

    ``max_length`` describes the **plaintext**. The column is widened automatically, because
    Fernet ciphertext is substantially longer than its input.

    ``deconstruct`` deliberately reports the original plaintext length rather than the
    widened one. Without that, every ``makemigrations`` run would read back the widened
    value, widen it again, and emit an endless series of no-op AlterField migrations.
    """

    def __init__(self, *args, **kwargs):
        self.plaintext_max_length = kwargs.get("max_length", 100)
        kwargs["max_length"] = self._column_width(self.plaintext_max_length)
        super().__init__(*args, **kwargs)

    @staticmethod
    def _column_width(plaintext_length: int) -> int:
        """Column width needed to hold the ciphertext for a plaintext of this length."""
        return len(base64.urlsafe_b64encode(b"x" * (plaintext_length + 100)).decode())

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        kwargs["max_length"] = self.plaintext_max_length
        return name, path, args, kwargs


def pii_lookup_hash(value: str | None) -> str:
    """
    A keyed, deterministic fingerprint of a PII value, for the one thing ciphertext cannot do:
    being looked up.

    Used to answer "does this Aadhaar already belong to a member?" without ever holding a
    searchable copy of the number. Same input always gives the same digest, so it can carry a
    database index; a different key gives a different digest, so the table is useless on its
    own.

    Keyed rather than a plain SHA-256 on purpose. An Aadhaar is twelve digits — a bare hash of
    one is brute-forced in minutes on a laptop, which would make the "fingerprint" column a
    plaintext column with extra steps. The key is derived from ``FIELD_ENCRYPTION_KEY`` with a
    domain label, so it is a distinct secret from the one that encrypts the value itself
    without needing a second entry in the secret store.
    """
    if not value:
        return ""

    key = getattr(settings, "FIELD_ENCRYPTION_KEY", "")
    if not key:
        raise ImproperlyConfigured("FIELD_ENCRYPTION_KEY is not set — PII cannot be fingerprinted.")

    root = key.encode() if isinstance(key, str) else key
    derived = hmac.new(root, b"pii-lookup-v1", hashlib.sha256).digest()
    return hmac.new(derived, str(value).encode(), hashlib.sha256).hexdigest()


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
