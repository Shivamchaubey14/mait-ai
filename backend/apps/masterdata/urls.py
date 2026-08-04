"""
URL routes for the masterdata domain.

Endpoints are specified in
``docs/API_CONTRACT.md`` (Master data upload, MPP/Member/Non-member)
and are implemented per ``docs/ROADMAP.md``.

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

app_name = "masterdata"

urlpatterns: list[path] = [
    # Populated in Phase 2, Days 4-5.
]
