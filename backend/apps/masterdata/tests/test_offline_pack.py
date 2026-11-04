"""
The offline pack (SRS §6.9) — a Mait's working set, for the handset to keep.

What matters: it is the Mait's own MPPs and nobody else's, a member's copy carries nothing the
capture flow does not read, and a refresh with ``since`` sends only who changed while still
listing everyone, so the handset can drop farmers who left.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.masterdata.models import Member, NonMember
from conftest import AnimalFactory, MemberFactory, MPPFactory

pytestmark = pytest.mark.django_db

BASE = "/api/v1/mait/offline-pack"


@pytest.fixture
def client_for(db):
    def make(user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    return make


@pytest.fixture
def mait_client(client_for, mait):
    from apps.accounts.models import Role

    mait.user.role = Role.MAIT
    mait.user.save(update_fields=["role"])
    return client_for(mait.user)


def a_non_member(mpp, name="Kamla Devi", mobile="9811100001"):
    return NonMember.objects.create(name=name, mobile_no=mobile, mpp=mpp, created_by_mait=mpp.mait)


class TestIndex:
    def test_lists_only_this_maits_mpps_and_the_breeds(self, mait_client, mpp):
        MPPFactory()  # another Mait's
        body = mait_client.get(f"{BASE}/").json()

        assert [row["mpp_code"] for row in body["mpps"]] == [mpp.mpp_code]
        assert "server_time" in body
        assert isinstance(body["breeds"], list)

    def test_refuses_anyone_but_a_mait(self, client_for, admin_user):
        assert client_for(admin_user).get(f"{BASE}/").status_code == 403


class TestOneMpp:
    def test_sends_every_farmer_with_their_animals(self, mait_client, mpp):
        member = MemberFactory(mpp=mpp)
        AnimalFactory(member=member)
        other = a_non_member(mpp)

        body = mait_client.get(f"{BASE}/{mpp.mpp_code}/").json()

        assert body["full"] is True
        assert [row["member_code"] for row in body["members"]] == [member.member_code]
        assert len(body["members"][0]["animals"]) == 1
        assert [row["id"] for row in body["non_members"]] == [other.id]
        assert body["member_codes"] == [member.member_code]
        assert body["non_member_ids"] == [other.id]

    def test_a_member_carries_nothing_the_flow_does_not_read(self, mait_client, mpp):
        MemberFactory(mpp=mpp)
        row = mait_client.get(f"{BASE}/{mpp.mpp_code}/").json()["members"][0]

        for private in ("bank_name", "ifsc_code", "folio_no", "aadhar_no", "age", "education"):
            assert private not in row
        assert {"member_name", "mobile_no", "can_receive_otp", "animals"} <= row.keys()

    def test_another_maits_mpp_is_not_found(self, mait_client):
        assert mait_client.get(f"{BASE}/{MPPFactory().mpp_code}/").status_code == 404

    def test_since_sends_only_who_changed_but_lists_everyone(self, mait_client, mpp):
        old = MemberFactory(mpp=mpp)
        fresh = MemberFactory(mpp=mpp)
        an_hour_ago = timezone.now() - timedelta(hours=1)
        Member.objects.filter(pk=old.pk).update(updated_at=an_hour_ago - timedelta(hours=1))

        body = mait_client.get(f"{BASE}/{mpp.mpp_code}/", {"since": an_hour_ago.isoformat()}).json()

        assert body["full"] is False
        assert [row["member_code"] for row in body["members"]] == [fresh.member_code]
        # Still listed, so the handset keeps her.
        assert sorted(body["member_codes"]) == sorted([old.member_code, fresh.member_code])

    def test_a_new_animal_brings_her_owner_back(self, mait_client, mpp):
        member = MemberFactory(mpp=mpp)
        an_hour_ago = timezone.now() - timedelta(hours=1)
        Member.objects.filter(pk=member.pk).update(updated_at=an_hour_ago - timedelta(hours=1))
        AnimalFactory(member=member)

        body = mait_client.get(f"{BASE}/{mpp.mpp_code}/", {"since": an_hour_ago.isoformat()}).json()

        assert [row["member_code"] for row in body["members"]] == [member.member_code]

    def test_a_garbled_since_is_a_400(self, mait_client, mpp):
        response = mait_client.get(f"{BASE}/{mpp.mpp_code}/", {"since": "yesterday"})
        assert response.status_code == 400
