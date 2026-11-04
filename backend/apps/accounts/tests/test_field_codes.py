"""
Office codes for a farmer check with no signal (``accounts.field_codes``).

What matters: the phone and the server work out the same six digits from the same key; the
office can generate one only for a Mait in its reach and a farmer at that Mait's MPPs; a
capture carrying a code the office gave is marked checked and the office's row used; and one
carrying a code nobody gave is still recorded — and marked as exactly that.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.field_codes import KEY_DAYS, code_for, day_key, keys_for
from apps.accounts.models import PortalSection, Role, SuperOTP, User
from apps.ai_events.models import AIEvent
from conftest import AnimalFactory, MaitFactory, MemberFactory, MPPFactory

pytestmark = pytest.mark.django_db

ADMIN = "/api/v1/admin/super-otp/field-code/"
EVENTS = "/api/v1/ai-events/"
VERIFY = "/api/v1/farmers/otp/verify/"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def mait(db):
    mait = MaitFactory(name="Sunil Kumar")
    mait.user.role = Role.MAIT
    mait.user.save(update_fields=["role"])
    return mait


@pytest.fixture
def mpp(mait):
    return MPPFactory(mait=mait, plant_code="1101")


@pytest.fixture
def member(mpp):
    return MemberFactory(mpp=mpp, member_name="Kavita Devi", mobile_no="9811100001")


@pytest.fixture
def office(db):
    return User.objects.create_user(
        username="office-codes",
        password="a-long-enough-password",
        full_name="Office",
        role=Role.ADMIN,
        portal_sections=[PortalSection.SUPER_OTP],
    )


def capture(mait, mpp, member, **extra):
    animal = AnimalFactory(member=member)
    body = {
        "client_uuid": str(uuid.uuid4()),
        "mpp_code": mpp.mpp_code,
        "member_code": member.member_code,
        "animal_id": animal.id,
        **extra,
    }
    response = auth(mait.user).post(EVENTS, body, format="json")
    assert response.status_code == 201, response.content
    return AIEvent.objects.get(pk=response.json()["id"])


class TestTheCode:
    @override_settings(SECRET_KEY="pinned-secret-for-the-field-code-test", OTP_LENGTH=6)
    def test_matches_the_value_the_phone_is_pinned_to(self):
        # The same value is pinned in mobile/src/api/__tests__/fieldCode.test.ts. Change one,
        # change both — or the phone accepts codes the office never read out.
        key = day_key(42, date(2026, 10, 28))
        assert code_for(key, "9811100001") == "679261"
        assert code_for(key, "+91 98111 00001") == "679261"

    def test_is_one_maits_and_one_days(self, mait):
        today = timezone.localdate()
        code = code_for(day_key(mait.id, today), "9811100001")
        assert code_for(day_key(mait.id + 1, today), "9811100001") != code
        assert code_for(day_key(mait.id, today + timedelta(days=1)), "9811100001") != code

    def test_the_phone_carries_a_week_of_keys(self, mait):
        keys = keys_for(mait.id)
        assert len(keys) == KEY_DAYS
        assert keys[0]["day"] == timezone.localdate().isoformat()

    def test_the_offline_pack_hands_them_over(self, mait, mpp):
        body = auth(mait.user).get("/api/v1/mait/offline-pack/").json()
        assert len(body["field_keys"]) == KEY_DAYS
        assert "office_phone" in body


class TestTheOffice:
    def test_generates_the_code_the_phone_works_out(self, office, mait, member):
        response = auth(office).post(
            ADMIN, {"mait": mait.mobile_no, "member_code": member.member_code}, format="json"
        )
        assert response.status_code == 201, response.content
        body = response.json()

        assert body["code"] == code_for(day_key(mait.id, timezone.localdate()), "9811100001")
        # The number to call is hers, not the Mait's.
        assert body["number_on_file"] == "9811100001"
        assert body["farmer_name"] == "Kavita Devi"

    def test_asking_twice_is_the_same_code_and_the_same_row(self, office, mait, member):
        ask = {"mait": mait.sahayak_vendor_code, "member_code": member.member_code}
        first = auth(office).post(ADMIN, ask, format="json").json()
        second = auth(office).post(ADMIN, ask, format="json").json()
        assert first["code"] == second["code"]
        assert SuperOTP.objects.filter(offline_day__isnull=False).count() == 1

    def test_a_farmer_registered_with_no_signal_by_her_number(self, office, mait):
        response = auth(office).post(
            ADMIN,
            {"mait": mait.mobile_no, "farmer_mobile": "9811100009", "farmer_name": "Kamla"},
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["number_on_file"] == "9811100009"

    def test_not_for_a_member_at_somebody_elses_mpp(self, office, mait):
        stranger = MemberFactory(mpp=MPPFactory())
        response = auth(office).post(
            ADMIN, {"mait": mait.mobile_no, "member_code": stranger.member_code}, format="json"
        )
        assert response.status_code == 404

    def test_not_for_a_mait_outside_a_zonal_managers_zone(self, mait, member):
        from apps.masterdata.models import Zone, ZonePlant

        zone = Zone.objects.create(code="ELSEWHERE", name="Elsewhere")
        ZonePlant.objects.create(zone=zone, plant_code="9999")
        manager = User.objects.create_user(
            username="zonal",
            password="a-long-enough-password",
            full_name="Zonal",
            role=Role.ADMIN,
            portal_sections=[PortalSection.SUPER_OTP],
        )
        manager.zones.add(zone)
        response = auth(manager).post(
            ADMIN, {"mait": mait.mobile_no, "member_code": member.member_code}, format="json"
        )
        assert response.status_code == 404

    def test_one_farmer_only(self, office, mait, member):
        response = auth(office).post(
            ADMIN,
            {
                "mait": mait.mobile_no,
                "member_code": member.member_code,
                "farmer_mobile": "9811100009",
            },
            format="json",
        )
        assert response.status_code == 400

    def test_does_not_get_in_the_way_of_her_own_sms_code(self, office, mait, member, monkeypatch):
        # A no-signal code given earlier today must not turn the farmer's SMS code, once the
        # Mait has signal again, into "not the code the office read out".
        from apps.payments.services import issue_otp

        auth(office).post(
            ADMIN, {"mait": mait.mobile_no, "member_code": member.member_code}, format="json"
        )
        monkeypatch.setattr("apps.payments.services.generate_code", lambda mobile_no="": "111111")
        issue_otp(mobile_no="9811100001", purpose="farmer_verify")
        response = auth(mait.user).post(
            VERIFY, {"member_code": member.member_code, "otp": "111111"}, format="json"
        )
        assert response.status_code == 200, response.content


class TestOnArrival:
    def test_a_code_the_office_gave_marks_her_checked(self, office, mait, mpp, member):
        code = (
            auth(office)
            .post(ADMIN, {"mait": mait.mobile_no, "member_code": member.member_code}, format="json")
            .json()["code"]
        )
        event = capture(
            mait, mpp, member, office_code=code, office_code_day=timezone.localdate().isoformat()
        )

        assert event.farmer_check == AIEvent.FarmerCheck.OFFICE_CALL
        assert event.farmer_check_otp.status == SuperOTP.Status.USED

    def test_her_second_animal_on_the_same_visit_shares_the_check(self, office, mait, mpp, member):
        code = (
            auth(office)
            .post(ADMIN, {"mait": mait.mobile_no, "member_code": member.member_code}, format="json")
            .json()["code"]
        )
        day = timezone.localdate().isoformat()
        capture(mait, mpp, member, office_code=code, office_code_day=day)
        second = capture(mait, mpp, member, office_code=code, office_code_day=day)
        assert second.farmer_check == AIEvent.FarmerCheck.OFFICE_CALL

    def test_a_code_nobody_gave_is_recorded_and_marked(self, mait, mpp, member):
        # Worked out from the key alone — what a lifted key would produce. The office wrote
        # nothing, so nothing matches.
        today = timezone.localdate()
        code = code_for(day_key(mait.id, today), member.mobile_no)
        event = capture(mait, mpp, member, office_code=code, office_code_day=today.isoformat())

        assert event.farmer_check == AIEvent.FarmerCheck.OFFICE_CALL_UNMATCHED
        assert event.farmer_check_otp is None

    def test_a_check_done_by_the_server_carries_nothing(self, mait, mpp, member):
        assert capture(mait, mpp, member).farmer_check == ""

    def test_code_and_day_go_together(self, mait, mpp, member):
        animal = AnimalFactory(member=member)
        response = auth(mait.user).post(
            EVENTS,
            {
                "client_uuid": str(uuid.uuid4()),
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
                "office_code": "123456",
            },
            format="json",
        )
        assert response.status_code == 400


class TestOnTheMaitsPhone:
    def test_their_flagged_captures_can_be_asked_for(self, mait, mpp, member):
        today = timezone.localdate()
        flagged = capture(
            mait,
            mpp,
            member,
            office_code=code_for(day_key(mait.id, today), member.mobile_no),
            office_code_day=today.isoformat(),
        )
        capture(mait, mpp, member)

        body = auth(mait.user).get(f"{EVENTS}?farmer_check=office_call_unmatched").json()
        assert [row["id"] for row in body["results"]] == [flagged.id]
        assert body["results"][0]["farmer_check"] == "office_call_unmatched"
