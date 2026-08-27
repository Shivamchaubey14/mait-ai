"""
What a non-member keeps, and what it gives (SRS §6.3 step 2).

For the record, not for a rule: nothing prices, scopes or refuses anything on these figures.
They exist because a farmer registered in the field is a household the dairy has no SAP record
of — her cattle are counted nowhere and her milk is outside every figure the plant reports.
What a Mait writes down at registration is the only measure of her there is.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import NonMember

pytestmark = pytest.mark.django_db

BASE = "/api/v1/non-members/"


@pytest.fixture
def mait_client(db, mait, mpp):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="herd-admin",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


def registration(mpp, **overrides):
    return {
        "name": "Radha Singh",
        "father_husband_name": "Ram Singh",
        "relation": "husband",
        "mobile_no": "9876543210",
        "aadhar_no": "123456789012",
        "mpp": mpp.id,
        "consent": True,
        **overrides,
    }


class TestRegistering:
    def test_her_herd_is_recorded(self, mait_client, mpp):
        response = mait_client.post(
            BASE,
            registration(mpp, cattle_cows=3, cattle_buffaloes=2, daily_yield_litres="12.50"),
            format="json",
        )

        assert response.status_code == 201, response.json()
        her = NonMember.objects.get(pk=response.json()["id"])
        assert her.cattle_cows == 3
        assert her.cattle_buffaloes == 2
        assert her.daily_yield_litres == Decimal("12.50")

    def test_the_total_is_derived_not_stored(self, mait_client, mpp):
        response = mait_client.post(
            BASE, registration(mpp, cattle_cows=3, cattle_buffaloes=2), format="json"
        )

        # Derived, so it cannot end up disagreeing with its own parts.
        assert response.json()["cattle_total"] == 5

    def test_they_are_optional(self, mait_client, mpp):
        """
        The form already runs to eight fields.

        A required herd count is the field a Mait guesses at to get past it, and a guess is
        worse than a blank — a blank is visible, a guess is not.
        """
        response = mait_client.post(BASE, registration(mpp), format="json")

        assert response.status_code == 201, response.json()
        her = NonMember.objects.get(pk=response.json()["id"])
        assert her.cattle_cows == 0
        assert her.daily_yield_litres == Decimal("0")

    @pytest.mark.parametrize(
        "payload",
        [
            {"cattle_cows": 501},
            {"cattle_buffaloes": 501},
            {"daily_yield_litres": "10000"},
            {"cattle_cows": -1},
            {"daily_yield_litres": "-1"},
        ],
    )
    def test_a_wild_figure_is_refused(self, mait_client, mpp, payload):
        """
        The only thing between this and a stray digit is somebody's thumb in a yard.

        Eight litres typed as eighty is invisible once it has been averaged across a district,
        and there is no way to unpick it afterwards.
        """
        response = mait_client.post(BASE, registration(mpp, **payload), format="json")

        assert response.status_code == 400, response.json()


class TestWhatTheBackOfficeSees:
    def test_the_roster_carries_the_herd(self, admin_client, mait, mpp):
        NonMember.objects.create(
            name="Radha Singh",
            mobile_no="9876543210",
            mpp=mpp,
            created_by_mait=mait,
            cattle_cows=4,
            cattle_buffaloes=1,
            daily_yield_litres=Decimal("9.25"),
        )

        row = admin_client.get("/api/v1/admin/non-members/").json()["results"][0]

        assert row["cattle_cows"] == 4
        assert row["cattle_buffaloes"] == 1
        assert row["cattle_total"] == 5
        assert row["daily_yield_litres"] == "9.25"
