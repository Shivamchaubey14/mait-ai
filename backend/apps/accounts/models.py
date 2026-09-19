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
    # The person behind the counter at a depot, who hands approved stock to a Mait. Signs in
    # to the same app by OTP, because the store is a room with a phone in it rather than a desk
    # with a browser, and sees one store's queue and nothing else (apps/stores).
    STORE = "store", "Store keeper"


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
    # Beside Indents, because a store is where an approved indent goes next: which depot serves
    # which BMC/MCCs, and who stands behind its counter.
    STORES = "stores", "Stores"
    LEADERBOARD = "leaderboard", "Leaderboard"
    PREGNANCY = "pregnancy", "Pregnancy"
    EXCEPTIONS = "exceptions", "Exceptions"
    REPORTS = "reports", "Reports"
    # Its own section rather than a corner of Reports. Reports answers questions about the
    # work and carries no personal data; this one is a payment instruction, it leaves the
    # building with bank account numbers on it, and the account allowed to produce it is not
    # automatically the account allowed to pull an AI-event export.
    MAIT_PAYMENT = "mait-payment", "Mait payment"
    USERS = "users", "Users & roles"
    # Beside Users & roles: handing somebody a code that signs them in without their SMS is
    # account administration, and it belongs to the desk that already does that.
    SUPER_OTP = "super-otp", "Super OTP"
    # Beside Users & roles, and for the same reason: both hand out reach. That one says which
    # screens an account opens, this one says how much of the network it sees through them —
    # and an account that can edit zones can widen its own view, so it belongs behind the same
    # desk rather than among the operational screens.
    ZONES = "zones", "Zones"
    # Last, and beside Users & roles rather than among the operational screens: it is the
    # record of who did what, including who read a farmer's identity document, and the desk
    # that administers accounts is the one that answers for it.
    LOGS = "logs", "Audit log"


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
    zones = models.ManyToManyField(
        "masterdata.Zone",
        blank=True,
        related_name="users",
        help_text=(
            "Which zones this account sees. Empty means the whole network — the default, "
            "and what every head-office account keeps."
        ),
    )
    store = models.ForeignKey(
        "stores.Store",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="keepers",
        help_text="For a store keeper, the one store whose counter they work. Empty for "
        "everyone else.",
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
    def is_zonal_manager(self) -> bool:
        """
        An office Admin narrowed to at least one live zone — the dairy's zonal manager.

        Not a role, and deliberately not one: the business's zonal manager is an ordinary
        Admin with a zone and a few sections, and every "who" queryset in the product already
        narrows by ``zone_scope``. Minting a fourth role would fork all of them.

        What it does decide is the **app**. A head-office Admin has a desk, a browser and a
        password; a zonal manager is out at a depot with a handset, and it is this property —
        together with a mobile number on the account — that lets them sign in there
        (``apps.zonal``). A Super Admin is never scoped, so they are never this.
        """
        return (
            self.role == Role.ADMIN
            and self.is_active
            and self.zones.filter(is_active=True).exists()
        )

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

    @property
    def zone_scope(self) -> list[str] | None:
        """
        The plant codes this account may see, or ``None`` for the whole network.

        ``None`` and ``[]`` are different answers and the distinction is the whole of this
        property. ``None`` means unrestricted — no zone was assigned, which is every account
        that exists today and every head-office account after this. ``[]`` means restricted to
        nothing: a zone was assigned and it currently holds no chilling centres, so the honest
        answer is an empty dashboard rather than the network total.

        Reading them as the same thing is the one mistake here that fails open. It would hand
        a zone manager whose zone is still being set up the figures for all nineteen plants,
        and nothing on the screen would say so.

        A Super Admin is never scoped, for the same reason they are never section-scoped: they
        are the accounts that hand out zones, and one that could restrict its own view is one
        bad save from nobody being able to see the network.
        """
        from apps.masterdata.models import ZonePlant

        if self.role == Role.SUPER_ADMIN:
            return None
        zone_ids = list(self.zones.filter(is_active=True).values_list("id", flat=True))
        if not zone_ids:
            return None
        return list(
            ZonePlant.objects.filter(zone_id__in=zone_ids).values_list("plant_code", flat=True)
        )

    @property
    def zone_names(self) -> list[str]:
        """What the scope is called, for the line on screen that says so."""
        return list(self.zones.filter(is_active=True).values_list("name", flat=True))

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


class SuperOTP(TimeStampedModel):
    """
    A code generated on the portal, standing in for an SMS that never arrived — at any step.

    The SMS gateway is a third party, and when it is down — or a village's tower is not passing
    texts — every step that sends a code stops: signing in, checking a farmer is who she says,
    and her authorising a payment. At each of those the app offers to ask the office; an admin
    generates a code here and reads it out over the phone; it is typed into the same boxes the
    SMS code goes in, and ``verify_otp`` accepts it for that step and that number only.

    **Whom the office calls is the SMS's own recipient, never whoever asked.** For sign-in that
    is the account holder. For a farmer check or a payment it is *the farmer*, on the number on
    her record: she hears the code from the office and tells the Mait, exactly as she would have
    read it off the SMS. The Mait asking never learns it from the office — which is what keeps a
    farmer's consent meaning something when the code did not come by text.

    It is kept narrow:

    - Asked for only by a registered, active field user, and for a farmer step only against the
      farmer or payment already on their screen, after the SMS has actually been tried.
    - The code is shown to the admin once, when it is generated, and stored only as a salted
      hash. It works once, for ``SUPER_OTP_EXPIRY_SECONDS``, and for ``SUPER_OTP_MAX_ATTEMPTS``
      wrong tries. Generating a new one revokes the last.
    - The portal tells the admin to call the number *on file*, never the number that rang in.
      The code only signs in that number, so reading it to a stranger on another phone is the
      one way this can be abused, and the screen says so.
    - Every step — the ask, the code, its use, a refusal — is in the audit log.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "Asked for"
        ISSUED = "issued", "Code given"
        USED = "used", "Used to sign in"
        DECLINED = "declined", "Declined"
        REVOKED = "revoked", "Replaced by a newer code"

    #: Which step it stands in for — the SMS template it replaces (``OTPLog.Purpose``).
    purpose = models.CharField(max_length=20, default="login", db_index=True)
    #: Who asked: the account holder for sign-in, the Mait for a farmer step.
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="super_otps")
    #: The number the SMS was for, and the only number the code works on. The one to call.
    mobile_no = models.CharField(max_length=15, db_index=True)
    #: For a farmer step: who she is, and what it is about ("AI event 64 · ₹300 cash").
    farmer_name = models.CharField(max_length=150, blank=True)
    context = models.CharField(max_length=160, blank=True)
    ai_event_id = models.BigIntegerField(null=True, blank=True)
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.REQUESTED, db_index=True
    )

    # The ask. Empty when the user phoned the office rather than asking from the app.
    requested_at = models.DateTimeField(null=True, blank=True)
    request_count = models.PositiveSmallIntegerField(default=0)
    reason = models.CharField(max_length=200, blank=True)

    # The code. Never stored in the clear.
    code_hash = models.CharField(max_length=64, blank=True)
    issued_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="super_otps_issued",
    )
    issued_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)

    decided_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="super_otps_declined",
    )
    decline_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "super_otp"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["mobile_no", "status"], name="super_otp_mobile_status_idx"),
            models.Index(fields=["mobile_no", "purpose", "status"], name="super_otp_step_idx"),
            models.Index(fields=["status", "-requested_at"], name="super_otp_queue_idx"),
        ]

    def __str__(self) -> str:
        return f"Super OTP for {self.mobile_no} [{self.status}]"

    @property
    def state(self) -> str:
        """
        Where it stands now, which is not always what was last written.

        A code nobody used goes stale without anybody touching the row, and so does an ask
        nobody answered within ``SUPER_OTP_REQUEST_TTL_HOURS`` — by then the user has found
        signal, driven to the office, or given up, and it should not sit in the queue.
        """
        from django.conf import settings

        now = timezone.now()
        if self.status == self.Status.ISSUED:
            if self.expires_at and self.expires_at <= now:
                return "expired"
            if self.attempt_count >= settings.SUPER_OTP_MAX_ATTEMPTS:
                return "locked"
            return "issued"
        if self.status == self.Status.REQUESTED:
            lapsed = self.requested_at and (now - self.requested_at).total_seconds() > (
                settings.SUPER_OTP_REQUEST_TTL_HOURS * 3600
            )
            return "lapsed" if lapsed else "waiting"
        return self.status
