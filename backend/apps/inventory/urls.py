"""
URL routes for the inventory domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (Semen batch and Mait inventory).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    InventoryLineViewSet,
    LedgerViewSet,
    ProductAdminViewSet,
    StrawValidateView,
    inventory_oversight,
    inventory_summary,
    ledger_balance_check,
    mait_inventory_detail,
    product_catalogue,
)

app_name = "inventory"

router = DefaultRouter()
router.register("admin/products", ProductAdminViewSet, basename="admin-product")
router.register("mait/inventory/lines", InventoryLineViewSet, basename="inventory-line")
router.register("mait/inventory/ledger", LedgerViewSet, basename="inventory-ledger")

urlpatterns = [
    path(
        "semen-batches/<str:unique_no>/validate/",
        StrawValidateView.as_view(),
        name="straw-validate",
    ),
    path("config/products/", product_catalogue, name="product-catalogue"),
    path("mait/inventory/", inventory_summary, name="inventory-summary"),
    path("mait/inventory/check/", ledger_balance_check, name="inventory-check"),
    # Admin oversight across every Mait. Deliberately not under `mait/`, which is the
    # namespace for "the caller's own".
    path("admin/inventory/", inventory_oversight, name="inventory-oversight"),
    path(
        "admin/inventory/<int:mait_id>/",
        mait_inventory_detail,
        name="inventory-mait-detail",
    ),
    path("", include(router.urls)),
]
