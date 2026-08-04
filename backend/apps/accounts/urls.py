"""
URL routes for the accounts domain.

Endpoints are specified in ``docs/API_CONTRACT.md`` (Authentication, Admin users).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.

Mounted under ``/api/v1/auth/``.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    CurrentUserView,
    LogoutView,
    OTPSendView,
    OTPVerifyView,
    PasswordLoginView,
    ServerTimeView,
)

app_name = "accounts"

urlpatterns = [
    path("login/", PasswordLoginView.as_view(), name="login"),
    path("otp/send/", OTPSendView.as_view(), name="otp-send"),
    path("otp/verify/", OTPVerifyView.as_view(), name="otp-verify"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", CurrentUserView.as_view(), name="me"),
    path("time/", ServerTimeView.as_view(), name="server-time"),
]
