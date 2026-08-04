"""
Test settings.

Kept close to production semantics on purpose. In particular the database is a real MySQL
instance, not SQLite — the inventory invariant depends on InnoDB row locking and check
constraints (ADR 0002), and SQLite would let a broken implementation pass.
"""

from .base import *
from .base import DATABASES

DEBUG = False
SECRET_KEY = "test-only-key"
FIELD_ENCRYPTION_KEY = "dGVzdC1vbmx5LWZlcm5ldC1rZXktMzItYnl0ZXMtbG9uZyE="

DATABASES["default"]["TEST"] = {"CHARSET": "utf8mb4", "COLLATION": "utf8mb4_unicode_ci"}

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

SMS_GATEWAY = {"PROVIDER": "dummy", "API_KEY": "", "SENDER_ID": "TEST"}

# Throttling off by default; the throttle tests re-enable it explicitly.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    k: None for k in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
}
