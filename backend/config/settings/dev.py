"""Local development settings. Never used outside a developer machine."""

from .base import *
from .base import INSTALLED_APPS, MIDDLEWARE, env

DEBUG = True
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS += ["django_extensions", "debug_toolbar"]
MIDDLEWARE.insert(0, "debug_toolbar.middleware.DebugToolbarMiddleware")

INTERNAL_IPS = ["127.0.0.1", "localhost"]
DEBUG_TOOLBAR_CONFIG = {"SHOW_TOOLBAR_CALLBACK": lambda request: DEBUG}

CORS_ALLOW_ALL_ORIGINS = True

# OTPs print to the console instead of costing SMS credits.
SMS_GATEWAY = {"PROVIDER": "console", "API_KEY": "", "SENDER_ID": "MAITAI"}

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Tasks execute inline so a developer sees failures immediately rather than in a worker log.
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TASK_EAGER_PROPAGATES = True

# RESP protocol version for the cache client.
#
# Defaults to 3, which is what Redis 7 speaks — that is what Docker Compose, staging and
# production all run. Set REDIS_PROTOCOL=2 if your machine has a pre-6.0 Redis installed
# directly; those reject the RESP3 handshake with "unknown command 'HELLO'". Upgrading the
# local Redis, or just using `make up`, is the better fix.
CACHES["default"]["OPTIONS"]["CONNECTION_POOL_KWARGS"] = {
    "protocol": env.int("REDIS_PROTOCOL", default=3),
}
