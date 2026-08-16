"""
URL routes for the masterdata domain.

Endpoints are specified in
``docs/API_CONTRACT.md`` (Master data upload, MPP/Member/Non-member).

The contract is frozen: add routes to match it rather than inventing new shapes. If a route
genuinely needs to change, update the contract and the OpenAPI schema in the same pull
request — CI fails on schema drift.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AdminNonMemberViewSet,
    FarmerOTPSendView,
    FarmerOTPVerifyView,
    MasterUploadViewSet,
    MemberViewSet,
    MPPViewSet,
    NonMemberViewSet,
)

app_name = "masterdata"

router = DefaultRouter()
router.register("admin/uploads", MasterUploadViewSet, basename="upload")
# The back office's view of the farmers Maits registered in the field. Separate from
# `non-members/` below, which is a Mait's own working set — see the viewset's docstring.
router.register("admin/non-members", AdminNonMemberViewSet, basename="admin-non-member")
router.register("mpp", MPPViewSet, basename="mpp")
router.register("members", MemberViewSet, basename="member")
router.register("non-members", NonMemberViewSet, basename="non-member")

urlpatterns = [
    # Verification of the farmer, not of a payment: it comes before the capture proceeds and
    # charges nothing, so it lives with the people rather than with the money.
    path("farmers/otp/send/", FarmerOTPSendView.as_view(), name="farmer-otp-send"),
    path("farmers/otp/verify/", FarmerOTPVerifyView.as_view(), name="farmer-otp-verify"),
    path("", include(router.urls)),
]
