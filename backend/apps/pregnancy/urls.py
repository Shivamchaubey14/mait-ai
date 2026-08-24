"""Routes for pregnancy diagnosis. Registered under `/api/v1/` in `config/urls.py`."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import PregnancyCheckViewSet, mait_pregnancy_checks, pregnancy_oversight

app_name = "pregnancy"

router = DefaultRouter()
router.register("pregnancy-checks", PregnancyCheckViewSet, basename="pregnancy-check")

urlpatterns = [
    # Admin oversight across every Mait. Deliberately not under `pregnancy-checks/`, which is
    # the namespace for "the caller's own" — the same split `apps.inventory` draws.
    path("admin/pregnancy/", pregnancy_oversight, name="pregnancy-oversight"),
    path("admin/pregnancy/<int:mait_id>/", mait_pregnancy_checks, name="pregnancy-mait-detail"),
    path("", include(router.urls)),
]
