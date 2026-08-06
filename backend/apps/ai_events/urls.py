"""
URL routes for the ai events domain.

Endpoints are specified in
``docs/API_CONTRACT.md`` (AI event)
and are implemented per ``docs/ROADMAP.md``.

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views import AIEventViewSet

app_name = "ai_events"

# Empty prefix: config/urls.py already mounts this module at `ai-events/`. SimpleRouter
# rather than DefaultRouter because the latter's API-root view would sit on the same path as
# the list route and shadow it.
router = SimpleRouter()
router.register("", AIEventViewSet, basename="ai-event")

urlpatterns = [
    path("", include(router.urls)),
]
