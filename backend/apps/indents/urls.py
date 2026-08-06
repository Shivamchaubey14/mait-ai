"""
URL routes for the indents domain.

Endpoints are specified in
``docs/API_CONTRACT.md`` (Indent)
and are implemented per ``docs/ROADMAP.md``.

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views import IndentViewSet

app_name = "indents"

# Empty prefix: config/urls.py already mounts this module at `indents/`. SimpleRouter rather
# than DefaultRouter because the latter's API-root view would sit on the list route's path.
router = SimpleRouter()
router.register("", IndentViewSet, basename="indent")

urlpatterns = [
    path("", include(router.urls)),
]
