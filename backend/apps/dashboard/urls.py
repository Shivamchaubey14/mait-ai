"""
URL routes for the dashboard domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (Dashboard and reports).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

from apps.payments.reports import mait_payment, mait_payment_export, payout_scheme

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
    # Computed in `apps.payments`, where the money lives, but routed here with the rest of
    # `/reports/` — one file says what the reports surface is, rather than three apps each
    # adding a path to it and nobody able to see the whole list.
    path("reports/mait-payment/", mait_payment, name="reports-mait-payment"),
    path(
        "reports/mait-payment/export/",
        mait_payment_export,
        name="reports-mait-payment-export",
    ),
    # The terms the report is computed from, editable from the report's own screen. Under
    # `mait-payment/` rather than beside the other rate editors because these four figures
    # feed exactly one report and nothing else in the platform reads them.
    path("reports/mait-payment/scheme/", payout_scheme, name="reports-payout-scheme"),
]
