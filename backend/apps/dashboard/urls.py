"""
URL routes for the dashboard domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (Dashboard and reports).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

from .reports import export_csv, export_pregnancy_csv
from .views import activation_readiness, mait_performance, mpp_coverage, summary, trends

app_name = "dashboard"

urlpatterns = [
    path("dashboard/summary/", summary, name="summary"),
    path("dashboard/trends/", trends, name="trends"),
    path("dashboard/mait-performance/", mait_performance, name="mait-performance"),
    path("dashboard/mpp-coverage/", mpp_coverage, name="mpp-coverage"),
    path("dashboard/activation-readiness/", activation_readiness, name="activation-readiness"),
    path("reports/export/", export_csv, name="reports-export"),
    # A second export rather than a mode of the first: it is one row per *check*, not per
    # event, and the column an admin opens it for — who agreed to the visit — has no
    # meaning on an AI event at all.
    path("reports/pregnancy/", export_pregnancy_csv, name="reports-pregnancy"),
]
