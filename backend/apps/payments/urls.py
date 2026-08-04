"""
URL routes for the payments domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (§9.7 Payment) and are implemented in
Phase 4, Days 15-17 of ``docs/ROADMAP.md``.

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

app_name = "payments"

urlpatterns: list[path] = [
    # Populated in Phase 4, Days 15-17.
]
