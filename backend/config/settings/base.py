"""
Base Django settings shared by every environment.

Environment-specific modules (dev / staging / production / test) import from here and
override. Nothing environment-specific belongs in this file.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
env.read_env(BASE_DIR / ".env")

# --------------------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------------------
SECRET_KEY = env("DJANGO_SECRET_KEY", default="insecure-dev-key-override-in-every-real-env")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Fernet key protecting Aadhaar / PAN / bank columns at rest. Losing it makes those
# columns permanently unreadable — see docs/DEPLOYMENT.md.
FIELD_ENCRYPTION_KEY = env("FIELD_ENCRYPTION_KEY", default="")

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "drf_spectacular_sidecar",
    "django_celery_beat",
    "django_celery_results",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.masterdata",
    "apps.animals",
    "apps.inventory",
    "apps.ai_events",
    "apps.payments",
    "apps.indents",
    "apps.integrations",
    "apps.dashboard",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestIDMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --------------------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------------------
# utf8mb4 throughout: member and village names carry Devanagari.
DATABASES = {
    "default": {
        **env.db("DATABASE_URL", default="mysql://root:root@127.0.0.1:3306/maitai"),
        "ATOMIC_REQUESTS": False,
        "CONN_MAX_AGE": env.int("DB_CONN_MAX_AGE", default=60),
        "OPTIONS": {
            "charset": "utf8mb4",
            # STRICT_TRANS_TABLES makes MySQL reject bad data instead of silently
            # truncating it — non-negotiable when the data is member PII.
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}

# Read replica for dashboard/report queries (SRS §7 Scalability).
if env("DATABASE_REPLICA_URL", default=""):
    DATABASES["replica"] = {
        **env.db("DATABASE_REPLICA_URL"),
        "CONN_MAX_AGE": env.int("DB_CONN_MAX_AGE", default=60),
        "OPTIONS": {"charset": "utf8mb4"},
    }
    DATABASE_ROUTERS = ["apps.core.db_routers.ReplicaRouter"]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --------------------------------------------------------------------------------------
# Internationalisation
# --------------------------------------------------------------------------------------
LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

LANGUAGES = [("en", "English"), ("hi", "हिन्दी")]
LOCALE_PATHS = [BASE_DIR / "locale"]

# --------------------------------------------------------------------------------------
# Static & media
# --------------------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --------------------------------------------------------------------------------------
# Django REST Framework
# --------------------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    # Default-deny. Every endpoint opts in to its audience explicitly (SECURITY.md).
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardLimitOffsetPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.problem_details_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # OTP endpoints are the fraud surface — throttled hardest (SRS §16).
        "otp_send": "5/hour",
        "otp_verify": "10/hour",
        "login": "20/hour",
        "upload": "10/hour",
        "burst": "120/min",
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Mait AI Platform API",
    "DESCRIPTION": (
        "Artificial Insemination field operations platform for Shwetdhara Milk Producer "
        "Company. Serves the Mait mobile app, the admin web portal and the Indent Easy "
        "integration."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
    "SCHEMA_PATH_PREFIX": "/api/v1",
    "COMPONENT_SPLIT_REQUEST": True,
    # Must stay True. The generated schema is committed and CI diffs it to catch contract
    # drift, so the output has to be byte-identical between machines. Left unsorted, the
    # operation order follows introspection order and differs between environments — the
    # drift check then fails on a file whose content is identical, which trains everyone to
    # ignore it.
    "SORT_OPERATIONS": True,
    "TAGS": [
        {"name": "auth", "description": "Authentication and session management"},
        {"name": "master-data", "description": "SAP-sourced MPP, Mait and Member data"},
        {"name": "animals", "description": "Animal registry and breed configuration"},
        {"name": "inventory", "description": "Semen batches and Mait stock"},
        {"name": "ai-events", "description": "The AI event capture state machine"},
        {"name": "payments", "description": "Payment collection and OTP verification"},
        {"name": "indents", "description": "Stock requests and Indent Easy integration"},
        {"name": "dashboard", "description": "Aggregated reporting and exports"},
    ],
}

# --------------------------------------------------------------------------------------
# Celery
# --------------------------------------------------------------------------------------
CELERY_BROKER_URL = env("REDIS_URL", default="redis://127.0.0.1:6379/0")
CELERY_RESULT_BACKEND = "django-db"
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_TRACK_STARTED = True
# SAP imports of 100k+ rows are long-running; a soft limit lets them clean up first.
CELERY_TASK_SOFT_TIME_LIMIT = 60 * 25
CELERY_TASK_TIME_LIMIT = 60 * 30
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://127.0.0.1:6379/1"),
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

# --------------------------------------------------------------------------------------
# Domain configuration
# --------------------------------------------------------------------------------------
OTP_LENGTH = env.int("OTP_LENGTH", default=6)
OTP_EXPIRY_SECONDS = env.int("OTP_EXPIRY_SECONDS", default=300)  # SRS §6.5.1 — 5 minutes
OTP_MAX_ATTEMPTS = env.int("OTP_MAX_ATTEMPTS", default=3)  # SRS §6.5.1
IDEMPOTENCY_TTL_HOURS = env.int("IDEMPOTENCY_TTL_HOURS", default=24)
LOW_STOCK_THRESHOLD = env.int("LOW_STOCK_THRESHOLD", default=5)

SMS_GATEWAY = {
    "PROVIDER": env("SMS_GATEWAY_PROVIDER", default="console"),
    "API_KEY": env("SMS_GATEWAY_API_KEY", default=""),
    "SENDER_ID": env("SMS_GATEWAY_SENDER_ID", default="MAITAI"),
}

INDENT_EASY = {
    "BASE_URL": env("INDENT_EASY_BASE_URL", default=""),
    "API_KEY": env("INDENT_EASY_API_KEY", default=""),
    "WEBHOOK_SECRET": env("INDENT_EASY_WEBHOOK_SECRET", default=""),
    "TIMEOUT_SECONDS": env.int("INDENT_EASY_TIMEOUT", default=15),
}

# --------------------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------------------
# Never log OTP codes, JWTs or PII payloads — see SECURITY.md.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {name} {request_id} {message}",
            "style": "{",
        },
    },
    "filters": {"request_id": {"()": "apps.core.logging.RequestIDFilter"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
            "filters": ["request_id"],
        },
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING", "propagate": False, "handlers": ["console"]},
        "apps": {"level": env("LOG_LEVEL", default="INFO"), "propagate": True},
    },
}
