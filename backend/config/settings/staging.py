"""
Staging settings.

Production-shaped, with the differences that make it usable for UAT: verbose logging and a
lower error-sampling floor so nothing is missed during the acceptance window.
"""

from .production import *  # noqa: F401,F403
from .production import env

LOGGING["root"]["level"] = "DEBUG"  # noqa: F405
SENTRY_TRACES_SAMPLE_RATE = 1.0

# Staging carries an anonymised SAP snapshot, but the masking rules stay identical to
# production so UAT actually exercises them.
ENVIRONMENT = env("ENVIRONMENT", default="staging")
