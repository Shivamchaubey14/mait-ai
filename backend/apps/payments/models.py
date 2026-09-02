"""
Payment collection and OTP verification (SRS §6.5, §8.2 `payment` / `otp_log`).

Two modes with different proof requirements:

* **ONLINE** — one authorisation OTP, then a UTR number and a payment screenshot.
* **COD** — two OTPs. The first authorises, the second confirms the cash was handed over.

An AI event cannot complete until ``is_verified`` is true (SRS §6.5.3).
"""

from __future__ import annotations

import hashlib

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class Payment(TimeStampedModel):
    """One payment, one AI event."""

    class Mode(models.TextChoices):
        ONLINE = "ONLINE", "Online"
        COD = "COD", "Cash on delivery"
        # A member hands over nothing. The dairy takes the charge out of her milk payment at
        # the next payout, so the row exists to be reconciled against that payout rather than
        # to record a collection — and it needs no authorisation, because nobody is being
        # asked for money. The two check constraints below only bite on ONLINE and COD, so
        # this mode can be verified on its own.
        DEDUCTION = "DEDUCT", "Deducted from milk payment"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        VERIFIED = "verified", "Verified"
        FAILED = "failed", "Failed"

    ai_event = models.OneToOneField(
        "ai_events.AIEvent", on_delete=models.PROTECT, related_name="payment"
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    mode = models.CharField(max_length=6, choices=Mode.choices)

    # Step 1 — member authorisation OTP, required for both modes.
    member_otp_verified = models.BooleanField(default=False)
    member_otp_verified_at = models.DateTimeField(null=True, blank=True)

    # ONLINE only.
    utr_number = models.CharField(max_length=40, blank=True, db_index=True)
    payment_screenshot_url = models.CharField(max_length=255, blank=True)

    # COD only — the second confirmation OTP.
    cod_otp_verified = models.BooleanField(default=False)
    cod_otp_verified_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    failure_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "payment"
        ordering = ["-created_at"]
        constraints = [
            # A verified ONLINE payment without its proof would defeat the point of
            # collecting it.
            models.CheckConstraint(
                condition=(
                    ~models.Q(status="verified", mode="ONLINE")
                    | (~models.Q(utr_number="") & ~models.Q(payment_screenshot_url=""))
                ),
                name="online_verified_requires_utr_and_screenshot",
            ),
            models.CheckConstraint(
                condition=(
                    ~models.Q(status="verified", mode="COD")
                    | models.Q(cod_otp_verified=True, member_otp_verified=True)
                ),
                name="cod_verified_requires_both_otps",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="payment_status_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.mode} ₹{self.amount} [{self.status}]"

    @property
    def is_verified(self) -> bool:
        return self.status == self.Status.VERIFIED

    @property
    def requirements_met(self) -> bool:
        """Whether everything this mode needs has been collected (SRS §6.5)."""
        # A deduction asks nothing of anybody. Nothing changed hands in the yard, so there is
        # no authorisation to collect and no proof to upload — the dairy settles it against a
        # milk payment it already owes her, and this row is what it settles against.
        if self.mode == self.Mode.DEDUCTION:
            return True
        if not self.member_otp_verified:
            return False
        if self.mode == self.Mode.ONLINE:
            return bool(self.utr_number and self.payment_screenshot_url)
        return self.cod_otp_verified


class OTPLog(models.Model):
    """
    Every OTP issued and every attempt against it (SRS §6.5.2, §8.2 `otp_log`).

    The code is stored as a salted hash, never in the clear — an OTP table readable by
    anyone with database access would undermine the entire payment authorisation flow.
    """

    class Purpose(models.TextChoices):
        LOGIN = "login", "Mait login"
        # Sent to the farmer before the capture proceeds, to establish that the person the
        # Mait says they are standing with is reachable on the number the record carries.
        # It is not a payment: nothing is charged and nothing moves. It is the answer to
        # "is this her", asked of her phone rather than of the Mait.
        FARMER_VERIFY = "farmer_verify", "Farmer identity verification"
        PAYMENT_ONLINE = "payment_online", "Online payment authorisation"
        PAYMENT_COD = "payment_cod", "COD confirmation"

    purpose = models.CharField(max_length=20, choices=Purpose.choices, db_index=True)
    mobile_no = models.CharField(max_length=15, db_index=True)
    otp_code_hash = models.CharField(max_length=64)
    payment = models.ForeignKey(
        Payment, null=True, blank=True, on_delete=models.CASCADE, related_name="otp_logs"
    )
    is_verified = models.BooleanField(default=False)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    sent_via = models.CharField(max_length=20, blank=True)
    gateway_message_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "otp_log"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["mobile_no", "purpose", "-created_at"], name="otp_mobile_purpose_idx"
            ),
            models.Index(fields=["expires_at", "is_verified"], name="otp_expiry_idx"),
        ]

    def __str__(self) -> str:
        state = "verified" if self.is_verified else "pending"
        return f"{self.purpose} → {self.mobile_no} ({state})"

    @staticmethod
    def hash_code(code: str, mobile_no: str) -> str:
        """Salt with the mobile number so identical codes to different numbers differ."""
        return hashlib.sha256(f"{code}:{mobile_no}:{settings.SECRET_KEY}".encode()).hexdigest()

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    @property
    def attempts_exhausted(self) -> bool:
        return self.attempt_count >= settings.OTP_MAX_ATTEMPTS

    def matches(self, code: str) -> bool:
        return self.otp_code_hash == self.hash_code(code, self.mobile_no)


class MaitPayoutScheme(TimeStampedModel):
    """
    What the dairy pays a Mait for a month's work, and what it takes back out of it.

    Not the same direction of money as everything else in this app. `Payment` is a farmer
    paying for one insemination; this is the dairy settling with the technician who performed
    them all — a commission on each, a monthly retainer once the round is big enough to be
    somebody's job, less the cost of the straws and consumables issued to them over the month.

    **One row, like `PregnancyRate`.** A `TextChoices` key rather than a singleton boolean, so
    a second payable service is a row instead of a schema change.

    **Kept out of the build on purpose.** The commission and the retainer are the terms of a
    field agent's engagement; they change by negotiation, not by deploy, and a constant here
    would mean the office asking an engineer to change somebody's pay.

    The consumable side of the recovery is *not* held here — it is `Consumable.rate`, already
    maintained on the Products screen. Two places naming the price of a glove is one place
    where the report and the indent disagree about what a glove costs. Only the straw rate
    lives here, because a straw is a `SemenBatch` and carries no price of its own.
    """

    class Scheme(models.TextChoices):
        AI = "ai", "Artificial insemination"

    scheme = models.CharField(max_length=20, choices=Scheme.choices, default=Scheme.AI, unique=True)
    commission_per_ai = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="Paid to the Mait for one completed insemination, in rupees.",
    )
    monthly_fixed_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text=(
            "A flat monthly amount on top of the commission, paid only to a Mait who "
            "reached `fixed_min_ai` inseminations in the month. Zero switches it off."
        ),
    )
    fixed_min_ai = models.PositiveSmallIntegerField(
        default=0,
        help_text=(
            "Inseminations needed in the month to earn `monthly_fixed_amount`. The test is "
            "'at least this many' — a Mait on exactly the threshold earns it."
        ),
    )
    straw_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text=(
            "Recovered from the payout for each semen straw issued to the Mait during the "
            "month, in rupees. Consumables are recovered at `Consumable.rate` instead — the "
            "Products screen owns those."
        ),
    )

    class Meta:
        db_table = "mait_payout_scheme"

    def __str__(self) -> str:
        return (
            f"{self.get_scheme_display()}: ₹{self.commission_per_ai}/AI, "
            f"₹{self.monthly_fixed_amount} above {self.fixed_min_ai}"
        )

    @classmethod
    def current(cls) -> MaitPayoutScheme:
        """
        The scheme in force, created empty if the row has somehow gone.

        Every figure defaults to zero rather than to the terms that happened to be current
        when this was written. A payout report is read as a bank instruction, and a number
        invented by a fallback is the worst possible thing for it to carry — a zero is
        visibly wrong and gets fixed, a plausible 220 gets paid.
        """
        scheme, _ = cls.objects.get_or_create(scheme=cls.Scheme.AI)
        return scheme
