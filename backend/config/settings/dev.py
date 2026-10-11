"""Local development settings. Never used outside a developer machine."""

from .base import *
from .base import INSTALLED_APPS, MIDDLEWARE, REST_FRAMEWORK, env

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Behind the Caddy HTTPS edge (infra/caddy/Caddyfile) Django itself speaks plain HTTP on a
# loopback port, so it would otherwise build photo/media URLs as http://…:8001 and the app,
# loaded over https, would block them as mixed content. Caddy sets X-Forwarded-Proto: https;
# trusting it makes request.is_secure() true so Django emits https:// absolute URLs. Only
# Caddy can reach the loopback port, so nothing untrusted can forge this header here.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS += ["django_extensions", "debug_toolbar"]
MIDDLEWARE.insert(0, "debug_toolbar.middleware.DebugToolbarMiddleware")

INTERNAL_IPS = ["127.0.0.1", "localhost"]
DEBUG_TOOLBAR_CONFIG = {
    "SHOW_TOOLBAR_CALLBACK": lambda request: DEBUG,
    # The SQL panel pretty-prints every query through sqlparse, whose grouping pass caps out
    # at 10,000 tokens and raises "Maximum number of tokens exceeded" above it. The inventory
    # oversight endpoint resolves its straws with a single `id IN (…)` carrying thousands of
    # ids, which sails past that cap and turns the whole request into a 500 — but only through
    # the toolbar middleware, so it never showed up in the tests. Turning off prettifying skips
    # the grouping pass (the queries still appear, just unindented) and keeps the panel working
    # on the heavy admin screens. This is the HTTPS go-live path, which runs these dev settings.
    "PRETTIFY_SQL": False,
}

CORS_ALLOW_ALL_ORIGINS = True

# SMS gateway: inherit the env-driven config from base.py rather than hardcoding one here.
#
# This used to pin `{"PROVIDER": "console", ...}`, which did two harmful things at once: it
# ignored SMS_GATEWAY_PROVIDER/_API_KEY from the environment, so a dev box could never be
# pointed at the real gateway; and it dropped the `BASE_URL` and `TEMPLATES` keys base.py
# carries, so the moment the provider *was* switched to smsfortius the send crashed on a
# missing key rather than sending. base.py already defaults the provider to `console`, so a
# plain dev machine still prints to the console and costs no credits — but a deployment that
# sets SMS_GATEWAY_PROVIDER=smsfortius (with its API key) in backend/.env now actually sends.

# Numbers that always receive DEV_FIXED_OTP_CODE, for demonstrating the app without a live
# SMS gateway. Set DEV_FIXED_OTP_NUMBERS in backend/.env. Production refuses to boot if this
# is populated there.
DEV_FIXED_OTP_NUMBERS = env.list("DEV_FIXED_OTP_NUMBERS", default=[])
DEV_FIXED_OTP_CODE = env("DEV_FIXED_OTP_CODE", default="123456")

# The production OTP limits are 5 sends an hour, which is right for a fraud surface and
# useless for development: a morning of testing the login screen exhausts it in minutes and
# the app can only report that something went wrong. Loosened here and here only — base.py,
# which staging and production inherit, is untouched.
#
# `login` is here for exactly the same reason, and was missed. 20 an hour is nothing once the
# portal's own browser tests sign in per spec: the run starts failing on a 429 that reads, in
# every screenshot, as the feature under test being broken rather than as the throttle doing
# its job.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    **REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
    "otp_send": env("DEV_OTP_SEND_RATE", default="100/hour"),
    "otp_verify": env("DEV_OTP_VERIFY_RATE", default="200/hour"),
    "super_otp_request": env("DEV_SUPER_OTP_REQUEST_RATE", default="100/hour"),
    "login": env("DEV_LOGIN_RATE", default="500/hour"),
    # Relaxed for the same reason as the rest: the portal's browser tests walk the reset flow
    # per spec, and the production rate would start failing the run on a 429.
    "password_reset_request": env("DEV_PASSWORD_RESET_REQUEST_RATE", default="100/hour"),
    "password_reset_verify": env("DEV_PASSWORD_RESET_VERIFY_RATE", default="200/hour"),
}

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
