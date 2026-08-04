"""
URL routes for the ai events domain.

Endpoints are specified in
``docs/API_CONTRACT.md`` (AI event)
and are implemented per ``docs/ROADMAP.md``.

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

app_name = "ai_events"

urlpatterns: list[path] = [
    # Populated in Phase 3, Days 11-13.
]
