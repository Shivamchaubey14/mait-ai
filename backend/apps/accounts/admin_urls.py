"""
Admin user-management routes (SRS §9.10).

Mounted at the API root rather than under ``/auth/`` so the paths match the frozen contract:
``/api/v1/admin/users/``. Authentication endpoints and user administration are different
concerns and sit at different paths.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_views import AdminUserViewSet

app_name = "accounts_admin"

router = DefaultRouter()
router.register("admin/users", AdminUserViewSet, basename="admin-user")

urlpatterns = [
    path("", include(router.urls)),
]
