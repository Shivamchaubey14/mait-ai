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


class InPortalSection(BasePermission):
    """
    An office account may only reach the sections it has been assigned (SRS §6.8.3).

    The second half of portal RBAC. ``IsAdmin`` settles what kind of account may call an
    endpoint at all; this settles which of them, because two back-office admins doing
    different jobs should not both be able to rewrite the rate card.

    Enforced here rather than by rendering a shorter sidebar. A sidebar decides what is easy
    to find; it does not decide anything at all about a URL typed into the bar, and the
    portal is one static file per screen.

    Maits pass straight through. They have no portal — their scope is the MPPs they cover and
    the querysets already apply it — so gating them by section would refuse the app the
    master data it runs on.

    Use ``in_section`` to build one; do not subclass this directly.
    """

    sections: tuple[str, ...] = ()
    message = "Your account has not been given access to this part of the portal."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if not user.is_admin:
            return True
        return user.can_view_section(*self.sections)


def in_section(*sections: str) -> type[InPortalSection]:
    """
    A permission that admits an office account holding any of ``sections``.

    Any, not all: several endpoints serve more than one screen — the AI events list is also
    what Reports queries, and the SAP upload history is also the Assignment screen's — and an
    admin given one of the two must not be refused it because they lack the other.

        permission_classes = [IsAdmin, in_section(PortalSection.PRODUCTS)]
    """
    name = "In_" + "_".join(section.replace("-", "_") for section in sections)
    return type(name, (InPortalSection,), {"sections": tuple(sections)})


class IsAdminOrMaitReadOnly(BasePermission):
    """
    Admins do anything; a Mait may only read.

    Used on the master-data lookups a Mait needs to run the capture flow. Their queryset is
    separately scoped to their own MPPs — this only settles whether they may call the
    endpoint at all, not what comes back.
    """

    SAFE = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.role in (Role.SUPER_ADMIN, Role.ADMIN):
            return True
        return user.role == Role.MAIT and request.method in self.SAFE


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
