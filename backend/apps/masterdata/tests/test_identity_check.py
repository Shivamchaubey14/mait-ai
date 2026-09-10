"""
Catching a farmer who is already on file, before she is asked for cash (SRS §7, §16).

The registration form is the one screen in the product that ends with a Mait asking a farmer
for money. Everything on it used to be checked at the moment *Save* was tapped — which is after
the Mait has already told her she is being registered as a non-member, and a non-member pays in
the yard.

So the same rule is now answerable while the number is still going in. These tests are about
the two halves of it being genuinely different:

* an **Aadhaar** match is the same person, so the form must stop;
* a **mobile** match is a question, because one phone per household is normal, so the form
  warns and lets the Mait decide.

And about the thing that must never drift: the inline answer and the answer the create gives
have to be the same answer. A form that says the number is free and a create that then refuses
it is a Mait who stops believing either.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.masterdata.models import NonMember

pytestmark = pytest.mark.django_db

CHECK = "/api/v1/non-members/check/"
ROSTER = "/api/v1/non-members/roster/"
CREATE = "/api/v1/non-members/"

#: Nobody's, in either table.
FREE_AADHAAR = "999988887777"


@pytest.fixture
def mait_client(db, mait, mpp):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


@pytest.fixture
def member_on_the_roll(db, member):
    """A member with an Aadhaar and a number on file — the case that must never be missed."""
    member.aadhar_no = "111122223333"
    member.mobile_no = "9876543210"
    # `save()` is what computes the keyed fingerprint the lookup matches on.
    member.save()
    return member


@pytest.fixture
def already_registered(db, mait, mpp):
    return NonMember.objects.create(
        name="Sunita Devi",
        mpp=mpp,
        mobile_no="9812345678",
        aadhar_no="444455556666",
        created_by_mait=mait,
    )


class TestAadhaar:
    def test_names_the_member_it_belongs_to(self, mait_client, member_on_the_roll):
        """
        Named, not merely refused.

        The Mait's next action is to go back and find her in the roster, and "this Aadhaar is
        registered" leaves them guessing which of the forty farmers at the MPP is meant. A
        guess ends with the form filled in again with one digit changed.
        """
        response = mait_client.post(CHECK, {"aadhar_no": "111122223333"}, format="json")

        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["available"] is False
        assert body["kind"] == "member"
        assert member_on_the_roll.member_name in body["detail"]
        assert "pays nothing today" in body["detail"]

    def test_stops_the_form(self, mait_client, member_on_the_roll):
        """
        The one that has to block.

        A member recorded as a non-member is a farmer the Mait takes cash from for a service
        her milk payment has already covered — and she has no reason to query it, because she
        was asked and she paid.
        """
        body = mait_client.post(CHECK, {"aadhar_no": "111122223333"}, format="json").json()

        assert body["blocking"] is True

    def test_names_the_non_member_it_belongs_to(self, mait_client, already_registered):
        body = mait_client.post(CHECK, {"aadhar_no": "444455556666"}, format="json").json()

        assert body["available"] is False
        assert body["kind"] == "non_member"
        assert "Sunita Devi" in body["detail"]

    def test_says_so_when_the_number_is_free(self, mait_client, member_on_the_roll):
        body = mait_client.post(CHECK, {"aadhar_no": FREE_AADHAAR}, format="json").json()

        assert body["available"] is True
        assert body["blocking"] is False
        assert body["detail"] == ""

    def test_answers_nothing_until_all_twelve_digits_are_in(self, mait_client, member_on_the_roll):
        """
        A half-typed number is not a free one.

        The form asks on every keystroke. Eleven digits of a member's Aadhaar must not come
        back `available`, or the warning appears and then vanishes as the last digit lands —
        which reads as the app having changed its mind.
        """
        body = mait_client.post(CHECK, {"aadhar_no": "11112222333"}, format="json").json()

        # Falls through to the mobile branch, which has nothing to say either. What matters is
        # that it is not a positive "this Aadhaar is free".
        assert body["kind"] == ""

    def test_reads_the_number_the_way_the_card_prints_it(self, mait_client, member_on_the_roll):
        """The app groups it 4+4+4 as it is typed, and sends what is on screen."""
        body = mait_client.post(CHECK, {"aadhar_no": "1111 2222 3333"}, format="json").json()

        assert body["kind"] == "member"


class TestMobile:
    def test_warns_without_blocking(self, mait_client, member_on_the_roll):
        """
        The correction to the obvious design.

        Two women genuinely share a handset — a mother and a daughter, a household with one
        phone between it. Blocking on this would refuse real registrations in exactly the
        villages where that is normal, so it is a question put to the Mait rather than an
        answer given to them.
        """
        body = mait_client.post(CHECK, {"mobile_no": "9876543210"}, format="json").json()

        assert body["available"] is False
        assert body["kind"] == "member"
        assert body["blocking"] is False
        assert member_on_the_roll.member_name in body["detail"]

    def test_names_a_non_member_already_on_this_round(self, mait_client, already_registered):
        body = mait_client.post(CHECK, {"mobile_no": "9812345678"}, format="json").json()

        assert body["kind"] == "non_member"
        assert "Sunita Devi" in body["detail"]

    def test_says_nothing_about_a_number_nobody_has(self, mait_client, member_on_the_roll):
        body = mait_client.post(CHECK, {"mobile_no": "9000000001"}, format="json").json()

        assert body["available"] is True
        assert body["detail"] == ""


class TestItAgreesWithTheCreate:
    """
    The inline check and the create must never disagree.

    They share one implementation (`masterdata.identity`) precisely so they cannot, and this is
    what holds that together: a second copy that drifted would be worse than no inline check,
    because the form would promise an answer the create then contradicted.
    """

    def payload(self, mpp, aadhaar):
        return {
            "name": "Radha Singh",
            "father_husband_name": "Ram",
            "relation": "husband",
            "mobile_no": "9811111111",
            "address": "Village",
            "aadhar_no": aadhaar,
            "cattle_cows": 2,
            "cattle_buffaloes": 0,
            "daily_yield_litres": "8",
            "mpp": mpp.id,
            "consent": True,
        }

    def test_what_the_check_blocks_the_create_refuses(self, mait_client, mpp, member_on_the_roll):
        checked = mait_client.post(CHECK, {"aadhar_no": "111122223333"}, format="json").json()
        created = mait_client.post(CREATE, self.payload(mpp, "111122223333"), format="json")

        assert checked["blocking"] is True
        assert created.status_code == 400
        # The same sentence, from the same rule — not two wordings of one refusal.
        assert member_on_the_roll.member_name in str(created.json())

    def test_what_the_check_allows_the_create_accepts(self, mait_client, mpp, member_on_the_roll):
        checked = mait_client.post(CHECK, {"aadhar_no": FREE_AADHAAR}, format="json").json()
        created = mait_client.post(CREATE, self.payload(mpp, FREE_AADHAAR), format="json")

        assert checked["available"] is True
        assert created.status_code == 201, created.json()


class TestAccess:
    def test_a_signed_out_handset_gets_nothing(self, db):
        """
        It answers about farmers, so it is behind the same door everything else is.

        The check is a lookup on somebody's Aadhaar. It tells a caller whether a number belongs
        to a member, which is exactly the question an unauthenticated caller must not be able
        to ask.
        """
        response = APIClient().post(CHECK, {"aadhar_no": "111122223333"}, format="json")

        assert response.status_code in (401, 403)

    def test_asks_for_something_to_check(self, mait_client):
        response = mait_client.post(CHECK, {}, format="json")

        assert response.status_code == 400


class TestRegisteredOffline:
    """
    The registration that was queued in a village and arrives hours later.

    Allowed by the business, so the two things that make it safe have to be true: it must not
    register her twice when the response is lost, and a Mait's key must not be a way to read
    somebody else's farmer.
    """

    def payload(self, mpp, key):
        return {
            "client_uuid": key,
            "name": "Radha Singh",
            "father_husband_name": "Ram",
            "relation": "husband",
            "mobile_no": "9811111111",
            "address": "Village",
            "aadhar_no": FREE_AADHAAR,
            "cattle_cows": 2,
            "cattle_buffaloes": 0,
            "daily_yield_litres": "8",
            "mpp": mpp.id,
            "consent": True,
        }

    def test_a_replay_returns_her_rather_than_registering_a_second_time(self, mait_client, mpp):
        """
        The failure that costs a farmer money.

        A duplicate non-member is a woman who can be asked for cash again for one service, and
        once the round is over a duplicate is indistinguishable from a second woman.
        """
        key = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

        first = mait_client.post(CREATE, self.payload(mpp, key), format="json")
        assert first.status_code == 201, first.json()

        replay = mait_client.post(CREATE, self.payload(mpp, key), format="json")

        assert replay.status_code == 200, replay.json()
        assert replay.json()["id"] == first.json()["id"]
        assert NonMember.objects.filter(client_uuid=key).count() == 1

    def test_the_back_office_needs_no_key(self, mait_client, mpp):
        """It registers non-members too, and has no handset to mint one."""
        body = self.payload(mpp, None)
        body.pop("client_uuid")

        response = mait_client.post(CREATE, body, format="json")

        assert response.status_code == 201, response.json()
        assert NonMember.objects.get(name="Radha Singh").client_uuid is None


class TestRoster:
    """
    What the handset keeps so it can warn about a duplicate with no signal.

    The Aadhaar check stays on the server permanently. This is the half that can travel, and
    the tests are mostly about what must *not* be in it.
    """

    def test_lists_both_kinds_of_farmer_at_the_collection_point(
        self, mait_client, mpp, member_on_the_roll, already_registered
    ):
        rows = mait_client.get(ROSTER, {"mpp__mpp_code": mpp.mpp_code}).json()

        by_number = {row["mobile_no"]: row for row in rows}
        assert by_number["9876543210"]["kind"] == "member"
        assert by_number["9812345678"]["kind"] == "non_member"

    def test_carries_no_aadhaar(self, mait_client, mpp, member_on_the_roll):
        """
        The line that must never move.

        An Aadhaar is twelve digits, so a set of them on a handset is brute-forceable whatever
        it was hashed with — which is why the check that actually decides is server-side and
        stays there.
        """
        rows = mait_client.get(ROSTER, {"mpp__mpp_code": mpp.mpp_code}).json()

        assert rows
        for row in rows:
            assert set(row) == {"name", "mobile_no", "kind"}

    def test_says_nothing_about_a_collection_point_this_mait_does_not_cover(
        self, mait_client, member_on_the_roll
    ):
        rows = mait_client.get(ROSTER, {"mpp__mpp_code": "SOMEBODY-ELSES"}).json()

        assert rows == []

    def test_leaves_out_a_farmer_with_no_number_to_match_on(self, mait_client, mpp, member):
        member.mobile_no = ""
        member.save(update_fields=["mobile_no"])

        rows = mait_client.get(ROSTER, {"mpp__mpp_code": mpp.mpp_code}).json()

        assert all(row["mobile_no"] for row in rows)
