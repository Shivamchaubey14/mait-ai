"""
Is this farmer already on file? (SRS §7 Compliance, §16)

One rule, asked in two places. It used to live inside ``NonMemberSerializer.validate_aadhar_no``
and could therefore only be asked by submitting the form — which is the wrong moment, because
by the time a Mait taps *Save* they have already told the farmer she is being registered as a
non-member, and a non-member pays cash in the yard. The check has to be answerable while the
number is still being typed.

So the rule moved here and the serializer calls it. There is exactly one implementation: a
second copy that drifted would be worse than no inline check at all, because the form would
promise an answer the create then contradicted.

**Why the number never leaves the server.** Both lookups are on the keyed fingerprint
(``pii_lookup_hash``), never on the Aadhaar itself — the encrypted column cannot be searched,
and adding a searchable copy would be a worse problem than the one being solved. It also rules
out the obvious-looking way to make this work offline: shipping the fingerprints to the handset
so it can match locally. An Aadhaar is twelve digits, so anyone holding the app could try all
of them against a downloaded set and recover every member's number. The key that makes the
fingerprint safe would have to travel with it to be usable, which is the same as not having a
key. This check is online, permanently and on purpose.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.core.fields import pii_lookup_hash

from .models import Member, NonMember


@dataclass(frozen=True)
class Clash:
    """
    Somebody this identifier already belongs to.

    ``detail`` is written to be read aloud in a yard, and it names her: "this Aadhaar is
    registered" leaves a Mait guessing which of the forty farmers at the MPP they are being
    told about, and guessing ends with the form being filled in again with one digit changed.
    """

    #: ``member`` or ``non_member`` — the two are opposite instructions to the Mait, so the
    #: app branches on this rather than on the wording.
    kind: str
    detail: str


def aadhaar_clash(digits: str, *, exclude_non_member=None) -> Clash | None:
    """
    Who this Aadhaar already belongs to, or ``None`` when it belongs to nobody.

    The membership check is what stops the fraud the non-member path invites: a member
    recorded as a non-member is a farmer the Mait can take cash from for a service the dairy
    has already paid for out of her milk payment. She has no reason to query it — she was asked
    for money and she paid it.

    The non-member check closes the other half of the same hole. One Aadhaar could otherwise be
    registered any number of times: at a second MPP, or at the same one on a different mobile —
    the only uniqueness the table has of its own is mobile-per-MPP. Every copy is a farmer who
    can be charged again, and a duplicate is indistinguishable from a second woman once the
    round is over.

    ``exclude_non_member`` is the row being edited, so an update does not clash with itself.
    """
    fingerprint = pii_lookup_hash(digits)

    member = Member.objects.filter(aadhar_hash=fingerprint).select_related("mpp").first()
    if member is not None:
        return Clash(
            kind="member",
            detail=(
                f"{member.member_name} is already a member at "
                f"{member.mpp.mpp_name} ({member.member_code}). "
                "Record this as a member — she pays nothing today."
            ),
        )

    already = NonMember.objects.filter(aadhar_hash=fingerprint)
    if exclude_non_member is not None:
        already = already.exclude(pk=exclude_non_member.pk)
    duplicate = already.select_related("mpp").first()
    if duplicate is not None:
        return Clash(
            kind="non_member",
            detail=(
                f"This Aadhaar is already registered to {duplicate.name} at "
                f"{duplicate.mpp.mpp_name}. She is on file — pick her instead of "
                "registering her twice."
            ),
        )

    return None


def mobile_clash(mobile_no: str, *, exclude_non_member=None) -> Clash | None:
    """
    Who else this mobile number is on file for, or ``None``.

    **A warning, never a refusal, and the difference matters.** Two women genuinely share a
    handset — a mother and a daughter, or a household with one phone between it — so a match
    here is a question, not an answer. Blocking on it would refuse real registrations in
    exactly the villages where one phone per household is the norm.

    What it is for is the moment before the money: a Mait who types a number that already
    belongs to a member is told so while the farmer is standing there, and can go and look
    rather than registering her a second time and asking her for cash.

    Unlike the Aadhaar, this one the handset can also answer on its own. Members' and
    non-members' mobile numbers are already served to the app unmasked and cached for the
    round — they have to be, because a Mait has to be able to ring a farmer — so the app makes
    the same check with no signal (see `AddNonMemberScreen`). This is the online copy of that
    rule, and the two must agree.
    """
    digits = "".join(c for c in mobile_no if c.isdigit())
    if len(digits) != 10:
        return None

    member = Member.objects.filter(mobile_no=digits).select_related("mpp").first()
    if member is not None:
        return Clash(
            kind="member",
            detail=(
                f"This number is on file for {member.member_name}, a member at "
                f"{member.mpp.mpp_name} ({member.member_code}). If that is the same farmer, "
                "record her as a member — she pays nothing today."
            ),
        )

    already = NonMember.objects.filter(mobile_no=digits)
    if exclude_non_member is not None:
        already = already.exclude(pk=exclude_non_member.pk)
    duplicate = already.select_related("mpp").first()
    if duplicate is not None:
        return Clash(
            kind="non_member",
            detail=(
                f"This number is on file for {duplicate.name} at {duplicate.mpp.mpp_name}. "
                "If that is the same farmer, pick her instead of registering her twice."
            ),
        )

    return None
