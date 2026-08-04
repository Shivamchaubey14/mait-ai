"""
Production settings.

Every value here that could weaken security is hardcoded rather than read from the
environment. A misconfigured env var must not be able to turn HSTS off.
"""

import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")

# --------------------------------------------------------------------------------------
# Transport security (SRS §7 — TLS 1.2+ everywhere)
# --------------------------------------------------------------------------------------
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])

# --------------------------------------------------------------------------------------
# Object storage — AI photos and payment screenshots (SRS §15)
# --------------------------------------------------------------------------------------
STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("AWS_STORAGE_BUCKET_NAME"),
            "region_name": env("AWS_S3_REGION_NAME", default="ap-south-1"),
            "default_acl": "private",
            "querystring_auth": True,      # signed URLs only
            "querystring_expire": 3600,
            "file_overwrite": False,
            "object_parameters": {"ServerSideEncryption": "AES256"},
        },
    },
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --------------------------------------------------------------------------------------
# Observability
# --------------------------------------------------------------------------------------
if env("SENTRY_DSN", default=""):
    sentry_sdk.init(
        dsn=env("SENTRY_DSN"),
        integrations=[DjangoIntegration(), CeleryIntegration()],
        environment=env("ENVIRONMENT", default="production"),
        release=env("APP_VERSION", default="unknown"),
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.1),
        # PII must never leave the platform via error reports.
        send_default_pii=False,
    )

# Fail fast at boot rather than at the first PII read.
if not env("FIELD_ENCRYPTION_KEY", default=""):
    raise RuntimeError(
        "FIELD_ENCRYPTION_KEY is required in production — PII columns cannot be "
        "read or written without it."
    )
