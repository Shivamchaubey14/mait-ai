"""Routes for pregnancy diagnosis. Registered under `/api/v1/` in `config/urls.py`."""

from rest_framework.routers import DefaultRouter

from .views import PregnancyCheckViewSet

app_name = "pregnancy"

router = DefaultRouter()
router.register("pregnancy-checks", PregnancyCheckViewSet, basename="pregnancy-check")

urlpatterns = router.urls
