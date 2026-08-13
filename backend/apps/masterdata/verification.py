"""
Farmer verification before a capture proceeds (SRS §6.5, §16).

A code is sent to the farmer's own number and read back by the Mait. It charges nothing and
moves nothing — it is the question "is this her" asked of her phone rather than of the person
standing in front of her with the handset.

**The number is never taken from the request.** It is read off the record the Mait says they
are working with, because a Mait who could nominate the destination could nominate their own
phone, and a verification a Mait can satisfy alone verifies nothing. That single rule is the
entire security value of this module; everything else here is plumbing around it.

The OTP mechanics — hashing, five-minute expiry, three attempts, the audit trail, the fixed
development code — are the ones already used for login and for payment authorisation
(``apps.payments.services``). A second implementation would be a second thing to get wrong.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import Member, NonMember


class FarmerKeySerializer(serializers.Serializer):
    """Exactly one of the two ways to name a farmer."""

    member_code = serializers.CharField(required=False, allow_blank=True)
    non_member_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        member_code = (attrs.get("member_code") or "").strip()
        non_member_id = attrs.get("non_member_id")
        if bool(member_code) == bool(non_member_id):
            raise serializers.ValidationError("Supply exactly one of member_code or non_member_id.")
        attrs["member_code"] = member_code
        return attrs


class FarmerOTPVerifySerializer(FarmerKeySerializer):
    otp = serializers.CharField(max_length=10)


def resolve_farmer(*, mait, member_code: str = "", non_member_id: int | None = None):
    """
    Find the farmer and the number their code will go to.

    Scoped to the Mait's own MPPs, the same as every other read in the capture flow: a Mait
    must not be able to send a code to a farmer they do not serve, which would be both a
    nuisance to that farmer and a way to fish for numbers.

    Returns ``(farmer, mobile_no)``. A farmer outside the Mait's MPPs is reported as missing
    rather than as forbidden — the difference would confirm that the record exists.
    """
    if member_code:
        member = Member.objects.select_related("mpp").filter(member_code=member_code).first()
        if member is None or member.mpp.mait_id != getattr(mait, "id", None):
            return None, ""
        return member, (member.mobile_no or "").strip()

    non_member = NonMember.objects.select_related("mpp").filter(pk=non_member_id).first()
    if non_member is None or non_member.mpp.mait_id != getattr(mait, "id", None):
        return None, ""
    return non_member, (non_member.mobile_no or "").strip()


def mask_mobile(mobile_no: str) -> str:
    """
    ``••••• 20448`` — enough for the Mait to read out and for the farmer to recognise, not
    enough for a number to be copied off a screen that is passed around a yard.
    """
    digits = "".join(character for character in mobile_no if character.isdigit())
    if len(digits) < 4:
        return ""
    return f"{'•' * (len(digits) - 4)} {digits[-4:]}"
