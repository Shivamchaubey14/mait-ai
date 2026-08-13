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
FIELD_ENCRYPTION_KEY = "bWFpdGFpLXRlc3Qta2V5LWRvLW5vdC11c2UtcmVhbCE="

DATABASES["default"]["TEST"] = {"CHARSET": "utf8mb4", "COLLATION": "utf8mb4_unicode_ci"}

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

# Eager, and inline with it. `run_in_background` puts eager tasks on a thread so a dev server
# can answer 202 while an import runs — correct for a browser, useless for a test, which would
# then assert against a database the import has not reached yet.
BACKGROUND_TASKS_INLINE = True

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

SMS_GATEWAY = {"PROVIDER": "dummy", "API_KEY": "", "SENDER_ID": "TEST"}

# Off, whatever a developer keeps in their own .env. It is read from the environment in
# `base`, so a machine set up to demo the app with a fixed code was quietly running a
# different suite from CI: every OTP the same six digits, and the tests that prove a resend
# invalidates the previous code passing or failing by accident of local configuration.
# The tests that need a known code set it themselves, per test.
DEV_FIXED_OTP_NUMBERS: list[str] = []

# Throttling off by default; the throttle tests re-enable it explicitly.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    k: None for k in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
}
