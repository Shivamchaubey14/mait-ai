"""Payment serializers (SRS §6.5, §9.7)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Payment

MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024


class PaymentSerializer(serializers.ModelSerializer):
    """Read shape for one payment."""

    mode_display = serializers.CharField(source="get_mode_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "ai_event",
            "amount",
            "mode",
            "mode_display",
            "status",
            "status_display",
            "is_verified",
            "member_otp_verified",
            "cod_otp_verified",
            "utr_number",
            "payment_screenshot_url",
            "failure_reason",
            "created_at",
        ]
        read_only_fields = fields


class PaymentInitiateSerializer(serializers.Serializer):
    """
    How she is paying.

    The mode is the Mait's to choose only for a non-member, who is the only farmer who hands
    anything over. A member's is decided by the server — the dairy takes it out of her milk
    payment — and a request that tries to name one for her is ignored rather than refused,
    because the answer was never the app's to give.
    """

    mode = serializers.ChoiceField(choices=[Payment.Mode.COD, Payment.Mode.ONLINE], required=False)


class PaymentOTPSerializer(serializers.Serializer):
    otp = serializers.CharField(max_length=10)


class PaymentProofSerializer(serializers.Serializer):
    """
    Proof of an online payment: the reference she read out, and the screen she paid on.

    Both, not either. A UTR without a screenshot is a number a Mait could invent, and a
    screenshot without a UTR is an image nobody can reconcile against a bank statement.
    """

    utr_number = serializers.CharField(max_length=40)
    screenshot = serializers.ImageField()

    def validate_screenshot(self, value):
        if value.size > MAX_SCREENSHOT_BYTES:
            raise serializers.ValidationError(
                f"Keep the screenshot under {MAX_SCREENSHOT_BYTES // 1024 // 1024} MB."
            )
        return value
