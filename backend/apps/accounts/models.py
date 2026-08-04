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
    """SRS §5. Permission classes in apps/core/permissions.py map onto these."""

    SUPER_ADMIN = "super_admin", "Super Admin"
    ADMIN = "admin", "Admin / Back-office"
    MPP_OPERATOR = "mpp_operator", "MPP Operator"
    MAIT = "mait", "Mait (Field Agent)"


class UserManager(BaseUserManager):
    def create_user(self, username: str, password: str | None = None, **extra):
        if not username:
            raise ValueError("A username is required.")
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

    Admins and MPP Operators log in with a password; Maits log in with a mobile OTP
    (SRS §6.8.2). Both are the same model so RBAC has a single subject.
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

    def touch_login(self) -> None:
        self.last_login_at = timezone.now()
        self.save(update_fields=["last_login_at", "updated_at"])


class MPPOperatorAssignment(TimeStampedModel):
    """Which MPPs an operator may read (SRS §5 — operator access is read-only and scoped)."""

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="mpp_assignments",
        limit_choices_to={"role": Role.MPP_OPERATOR},
    )
    mpp = models.ForeignKey(
        "masterdata.MPP", on_delete=models.CASCADE, related_name="operator_assignments"
    )

    class Meta:
        db_table = "mpp_operator_assignment"
        constraints = [
            models.UniqueConstraint(fields=["user", "mpp"], name="uniq_operator_mpp"),
        ]

    def __str__(self) -> str:
        return f"{self.user.full_name} → {self.mpp.mpp_code}"
