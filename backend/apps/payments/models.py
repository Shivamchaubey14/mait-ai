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
