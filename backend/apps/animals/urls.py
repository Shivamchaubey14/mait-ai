"""
URL routes for the animals domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (Animal).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AnimalViewSet, BreedConfigViewSet

app_name = "animals"

router = DefaultRouter()
router.register("animals", AnimalViewSet, basename="animal")
router.register("config/breeds", BreedConfigViewSet, basename="breed-config")

urlpatterns = [
    path("", include(router.urls)),
]
