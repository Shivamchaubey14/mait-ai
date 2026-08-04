"""
Role-based permission classes (SRS §5, §6.8.3).

RBAC is enforced here, at the API layer — never by hiding a button in the UI. Every view
declares its audience explicitly; the DRF default is IsAuthenticated, so a view without a
permission class is authenticated-but-unscoped, not open.
"""

from rest_framework.permissions import BasePermission

from apps.accounts.models import Role


class _RolePermission(BasePermission):
    allowed_roles: tuple[str, ...] = ()

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.role in self.allowed_roles)


class IsSuperAdmin(_RolePermission):
    allowed_roles = (Role.SUPER_ADMIN,)


class IsAdmin(_RolePermission):
    """Super Admin or back-office Admin."""

    allowed_roles = (Role.SUPER_ADMIN, Role.ADMIN)


class IsMait(_RolePermission):
    allowed_roles = (Role.MAIT,)


class IsMPPOperator(_RolePermission):
    allowed_roles = (Role.MPP_OPERATOR,)


class IsAdminOrReadOnlyOperator(BasePermission):
    """Admins write; MPP Operators read (SRS §5 — operator access is read-only)."""

    SAFE = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.role in (Role.SUPER_ADMIN, Role.ADMIN):
            return True
        return user.role == Role.MPP_OPERATOR and request.method in self.SAFE


class IsOwnMaitRecord(BasePermission):
    """
    Object-level check that a Mait only ever touches their own records.

    Backstop, not the primary control — querysets are already filtered by the requesting
    Mait. Defence in depth matters here because the alternative is one Mait consuming
    another's stock.
    """

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if user.role in (Role.SUPER_ADMIN, Role.ADMIN):
            return True
        mait = getattr(user, "mait_profile", None)
        if mait is None:
            return False
        owner = getattr(obj, "mait_id", None) or getattr(obj, "created_by_mait_id", None)
        return owner == mait.id
