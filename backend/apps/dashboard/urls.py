"""
URL routes for the dashboard domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (Dashboard and reports).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

from .views import activation_readiness, mait_performance, mpp_coverage, summary, trends

app_name = "dashboard"

urlpatterns = [
    path("dashboard/summary/", summary, name="summary"),
    path("dashboard/trends/", trends, name="trends"),
    path("dashboard/mait-performance/", mait_performance, name="mait-performance"),
    path("dashboard/mpp-coverage/", mpp_coverage, name="mpp-coverage"),
    path("dashboard/activation-readiness/", activation_readiness, name="activation-readiness"),
]
