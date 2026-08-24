"""Routes for pregnancy diagnosis. Registered under `/api/v1/` in `config/urls.py`."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PregnancyCheckViewSet,
    mait_pregnancy_checks,
    pregnancy_oversight,
    pregnancy_rate,
)

app_name = "pregnancy"

router = DefaultRouter()
router.register("pregnancy-checks", PregnancyCheckViewSet, basename="pregnancy-check")

urlpatterns = [
    # Admin oversight across every Mait. Deliberately not under `pregnancy-checks/`, which is
    # the namespace for "the caller's own" — the same split `apps.inventory` draws.
    path("admin/pregnancy/", pregnancy_oversight, name="pregnancy-oversight"),
    # Before the `<int:mait_id>` route, or "rate" would be tried as a Mait id.
    path("admin/pregnancy/rate/", pregnancy_rate, name="pregnancy-rate"),
    path("admin/pregnancy/<int:mait_id>/", mait_pregnancy_checks, name="pregnancy-mait-detail"),
    path("", include(router.urls)),
]
