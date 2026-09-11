"""
URL routes for stores.

Mounted at the API root: ``store/...`` is the keeper's app, ``admin/stores/...`` the portal's
Stores screen. Two prefixes rather than one because they are two audiences — a keeper must
never be one path segment away from the screen that decides which stores exist.
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views import (
    StoreAdminViewSet,
    StoreHandoverViewSet,
    StoreQueueViewSet,
    StoreStockViewSet,
    store_catalogue,
    store_home,
)

app_name = "stores"

keeper = SimpleRouter()
keeper.register("store/indents", StoreQueueViewSet, basename="store-indent")
keeper.register("store/handovers", StoreHandoverViewSet, basename="store-handover")
keeper.register("store/stock", StoreStockViewSet, basename="store-stock")

office = SimpleRouter()
office.register("admin/stores", StoreAdminViewSet, basename="store-admin")

urlpatterns = [
    path("store/", store_home, name="store-home"),
    path("store/catalogue/", store_catalogue, name="store-catalogue"),
    path("", include(keeper.urls)),
    path("", include(office.urls)),
]
