"""
URL routes for the payments domain.

Endpoints are specified in
``docs/API_CONTRACT.md`` (Payment)
and are implemented per ``docs/ROADMAP.md``.

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import path

from .views import (
    PaymentAmountView,
    PaymentDetailView,
    PaymentInitiateView,
    PaymentOTPVerifyView,
    PaymentProofView,
)

app_name = "payments"

# Keyed by the AI event, not by a payment id: that is what the app has in its hand, and one
# event has exactly one payment. A Mait never sees a payment id.
urlpatterns = [
    path("<int:ai_event_id>/", PaymentDetailView.as_view(), name="detail"),
    path("<int:ai_event_id>/amount/", PaymentAmountView.as_view(), name="amount"),
    path("<int:ai_event_id>/initiate/", PaymentInitiateView.as_view(), name="initiate"),
    path("<int:ai_event_id>/otp/verify/", PaymentOTPVerifyView.as_view(), name="otp-verify"),
    path("<int:ai_event_id>/proof/", PaymentProofView.as_view(), name="proof"),
]
