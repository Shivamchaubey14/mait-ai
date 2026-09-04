from django.urls import path

from .audit_api import audit_trail
from .audit_export import audit_trail_export
from .views import HealthView, ReadinessView

app_name = "core"

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("health/ready/", ReadinessView.as_view(), name="readiness"),
    # The trail this app has been writing since the first commit, finally readable from
    # outside a Django shell.
    path("admin/audit/", audit_trail, name="audit-trail"),
    # The same trail, same filters, as a workbook to hand an auditor. Above nothing and below
    # nothing — `admin/audit/` is an exact match, so the two cannot shadow each other.
    path("admin/audit/export/", audit_trail_export, name="audit-trail-export"),
]
