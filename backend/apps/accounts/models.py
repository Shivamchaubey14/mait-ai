"""Users, roles and OTP-based login (SRS §5, §6.8)."""

from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel

mobile_validator = RegexValidator(
    regex=r"^[6-9]\d{9}$",
    message="Enter a valid 10-digit Indian mobile number.",
)


class Role(models.TextChoices):
    """
    Platform roles. Permission classes in apps/core/permissions.py map onto these.

    There is deliberately no MPP Operator: the business confirmed the role does not exist
    in the organisation, so the SRS §5 entry for it is superseded. Anything an operator
    would have done is an Admin action.
    """

    SUPER_ADMIN = "super_admin", "Super Admin"
    ADMIN = "admin", "Admin / Back-office"
    MAIT = "mait", "Mait (Field Agent)"


class PortalSection(models.TextChoices):
    """
    The admin portal's sections — one per link in its sidebar (docs/SCREEN_INVENTORY.md).

    Role says what kind of account someone has; this says which of the seventeen screens
    that account is there to work. Two back-office admins are rarely the same job: the one
    who runs the SAP imports has no business in Rates, and the one who settles disputes on
    the AI events screen does not need the upload queue.

    The values are the ``data-page`` attribute each portal screen already carries, so a
    section is the same string in the sidebar, in the page it opens and in the permission
    guarding the endpoints behind it. Renaming one means renaming all three.
    """

    DASHBOARD = "dashboard", "Dashboard"
    UPLOADS = "uploads", "SAP upload"
    AI_EVENTS = "ai-events", "AI events"
    MAITS = "maits", "Maits"
    MPPS = "mpps", "MPPs"
    ASSIGNMENTS = "assignments", "Assignment"
    MEMBERS = "members", "Members"
    NON_MEMBERS = "non-members", "Non-members"
    INVENTORY = "inventory", "Inventory"
    PRODUCTS = "products", "Products"
    RATES = "rates", "Rates"
    INDENTS = "indents", "Indents"
    LEADERBOARD = "leaderboard", "Leaderboard"
    PREGNANCY = "pregnancy", "Pregnancy"
    EXCEPTIONS = "exceptions", "Exceptions"
    REPORTS = "reports", "Reports"
    USERS = "users", "Users & roles"


class UserManager(BaseUserManager):
    def create_user(self, username: str, password: str | None = None, **extra):
        if not username:
            raise ValueError("A username is required.")
        # An office account created without a word said about portal access gets all of it —
        # the behaviour every admin had before access was assignable, and the same default
        # the migration backfilled with. A caller that means "none" passes an empty list and
        # is left alone; silently creating a locked-out admin is what this avoids.
        if extra.get("role") == Role.ADMIN and "portal_sections" not in extra:
            extra["portal_sections"] = list(PortalSection.values)
        user = self.model(username=username, **extra)
        if password:
            user.set_password(password)
        else:
            # Maits authenticate by OTP and never have a usable password (SRS §6.8.2).
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, username: str, password: str, **extra):
        extra.setdefault("role", Role.SUPER_ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_active", True)
        if extra["role"] != Role.SUPER_ADMIN:
            raise ValueError("A superuser must have the super_admin role.")
        return self.create_user(username, password, **extra)


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    """
    Platform user.

    Admins log in with a password; Maits log in with a mobile OTP (SRS §6.8.2). Both are the
    same model so RBAC has a single subject.
    """

    username = models.CharField(max_length=64, unique=True, db_index=True)
    full_name = models.CharField(max_length=150)
    email = models.EmailField(blank=True)
    mobile_no = models.CharField(
        max_length=15,
        blank=True,
        db_index=True,
        validators=[mobile_validator],
        help_text="Required for Maits — this is where the login OTP is sent.",
    )
    role = models.CharField(max_length=20, choices=Role.choices, db_index=True)
    portal_sections = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Which admin-portal sections this account may open. Applies to Admins only — a "
            "Super Admin reaches everything and a Mait has no portal."
        ),
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    last_login_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["full_name", "role"]

    class Meta:
        db_table = "users"
        indexes = [models.Index(fields=["role", "is_active"], name="user_role_active_idx")]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.get_role_display()})"

    @property
    def is_admin(self) -> bool:
        return self.role in (Role.SUPER_ADMIN, Role.ADMIN)

    @property
    def allowed_sections(self) -> list[str]:
        """
        The portal sections this account may open, in sidebar order.

        A Super Admin is never restricted: they are the accounts that hand out access, and an
        access list that can lock its own keyholder out is one bad save away from a network
        with nobody able to fix it.

        Stored values are filtered against the current catalogue rather than trusted. A
        section retired from the product stays in the JSON of every account that had it, and
        handing that straight back would put a dead link in the sidebar.
        """
        if self.role == Role.SUPER_ADMIN:
            return list(PortalSection.values)
        if self.role != Role.ADMIN:
            return []
        held = set(self.portal_sections or [])
        return [section for section in PortalSection.values if section in held]

    def can_view_section(self, *sections: str) -> bool:
        """
        Whether this account may reach any one of ``sections``.

        Any rather than all, because several endpoints serve more than one screen — the Mait
        roster is read by both Maits and Assignment, and refusing it to someone who holds
        only one of the two would break the screen they were given.
        """
        allowed = set(self.allowed_sections)
        return any(section in allowed for section in sections)

    def touch_login(self) -> None:
        self.last_login_at = timezone.now()
        self.save(update_fields=["last_login_at", "updated_at"])
