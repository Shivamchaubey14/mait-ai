"""
The office changing a member's mobile number (W10).

The number is the one payment authorisation and farmer verification OTPs go to (SRS §6.5), so
changing it is changing who can say *yes* on her behalf. That is why it is an Admin's job
alone, why a reason is required, and why every change is written to the audit log with who,
when and why — the log keeps both numbers masked, because the log is read far more widely
than this screen.

**Once the office sets a number, SAP cannot take it back.** ``mobile_source`` becomes
``office``; the member-master importer never writes an existing member (``tasks``), and it
counts the rows where the file's number differs from one the office set, so the upload report
says so rather than leaving somebody to wonder whether it took.

**Nobody overwrites a change they did not see.** The caller says which number they were
looking at; if it has changed since, the request is refused with the number that is on file
now, rather than silently replacing one colleague's correction with another's.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.core.exceptions import InvalidStateTransition
from apps.core.models import AuditLog
from apps.core.services import record_audit

from .models import Member
from .phone import normalise_mobile
from .verification import mask_mobile

#: The entity the audit trail files these under, and reads them back by.
AUDIT_ENTITY = "member_mobile"

#: The shortest reason worth keeping. Below this it is a keystroke, not an explanation.
MIN_REASON = 4


class MemberMobileChangeSerializer(serializers.Serializer):
    mobile_no = serializers.CharField(max_length=20)
    reason = serializers.CharField(max_length=255)
    # The number the admin was looking at when they decided to change it. Optional, so a
    # script can still set a number, but the portal always sends it.
    expected_mobile = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate_mobile_no(self, value):
        digits = normalise_mobile(value)
        if not digits:
            raise serializers.ValidationError(
                "A 10-digit Indian mobile number, starting with 6, 7, 8 or 9."
            )
        return digits

    def validate_reason(self, value):
        value = value.strip()
        if len(value) < MIN_REASON:
            raise serializers.ValidationError(
                "Say why — the member rang, the Mait confirmed it, SAP had it wrong."
            )
        return value


@dataclass(frozen=True)
class MobileChange:
    member: Member
    before: str
    #: Other members already on file with the new number. A warning, never a refusal: a
    #: household often shares one phone.
    shared_with: list[dict]


class MobileChanged(InvalidStateTransition):
    """The number changed while somebody else was looking at the old one."""

    error_code = "mobile-changed"
    default_detail = "This member's number was changed while you were editing it."


@transaction.atomic
def change_member_mobile(
    *,
    member_id: int,
    mobile_no: str,
    reason: str,
    expected_mobile: str | None,
    actor,
    request=None,
) -> MobileChange:
    """
    Set a member's number, lock it against SAP, and audit it — or refuse, saying why.

    The row is locked for the read-compare-write, so two admins saving at the same moment are
    one success and one clear refusal, never a silent last-writer-wins.
    """
    member = Member.objects.select_for_update().select_related("mpp").get(pk=member_id)
    before = member.mobile_no or ""

    if expected_mobile is not None and normalise_mobile(expected_mobile) != before:
        on_file = mask_mobile(before) or "no number"
        raise MobileChanged(
            f"Somebody changed this number while you were editing it — it is now {on_file}. "
            "Reload the member and try again."
        )
    if mobile_no == before:
        raise serializers.ValidationError({"mobile_no": ["That is already the number on file."]})

    member.mobile_no = mobile_no
    member.mobile_source = Member.MobileSource.OFFICE
    member.mobile_updated_at = timezone.now()
    member.mobile_updated_by = actor
    member.save(
        update_fields=[
            "mobile_no",
            "mobile_source",
            "mobile_updated_at",
            "mobile_updated_by",
            "aadhar_hash",
            "updated_at",
        ]
    )

    record_audit(
        action=AuditLog.Action.UPDATE,
        entity_type=AUDIT_ENTITY,
        entity_id=member.id,
        actor=actor,
        request=request,
        meta={
            "member_code": member.member_code,
            "before": mask_mobile(before),
            "after": mask_mobile(mobile_no),
            "reason": reason[:255],
        },
    )

    shared_with = [
        {"member_code": other.member_code, "member_name": other.member_name}
        for other in Member.objects.filter(mobile_no=mobile_no)
        .exclude(pk=member.pk)
        .order_by("member_name")[:5]
    ]
    return MobileChange(member=member, before=before, shared_with=shared_with)


def mobile_history(member: Member) -> list[dict]:
    """Every change the office made to this member's number, newest first."""
    rows = (
        AuditLog.objects.filter(entity_type=AUDIT_ENTITY, entity_id=str(member.id))
        .select_related("actor")
        .order_by("-created_at", "-id")[:50]
    )
    return [
        {
            "when": row.created_at,
            "by": (row.actor.full_name or row.actor.username) if row.actor else "",
            "before": (row.meta_json or {}).get("before", ""),
            "after": (row.meta_json or {}).get("after", ""),
            "reason": (row.meta_json or {}).get("reason", ""),
        }
        for row in rows
    ]
