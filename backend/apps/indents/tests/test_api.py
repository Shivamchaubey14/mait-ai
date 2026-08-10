"""
Indent API tests (SRS §9.8).

The cases that matter are the boundary — a Mait must not see another's requests — and the
stale filter, which is the whole reason an admin opens this screen: an indent approved a week
ago that nobody issued, or one that never reached Indent Easy at all, is a Mait waiting on
stock that is not coming.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.indents.models import IndentRequest
from apps.inventory.models import ProductType
from apps.masterdata.models import Mait

pytestmark = pytest.mark.django_db

BASE = "/api/v1/indents"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def mait_client(mait):
    return auth(mait.user)


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-indents",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


class TestRaising:
    def test_a_mait_raises_an_indent(self, mait_client, mait):
        response = mait_client.post(
            f"{BASE}/",
            {"product_type": ProductType.STRAW, "breed": "MURRAH", "qty_requested": 25},
            format="json",
        )

        assert response.status_code == 201, response.json()
        assert response.json()["status"] == IndentRequest.Status.REQUESTED
        assert IndentRequest.objects.get().mait_id == mait.id

    def test_a_straw_request_must_name_a_breed(self, mait_client):
        """Straws are requested by breed — the depot chooses which physical straws to issue."""
        response = mait_client.post(
            f"{BASE}/",
            {"product_type": ProductType.STRAW, "qty_requested": 25},
            format="json",
        )
        assert response.status_code == 400
        assert "breed" in response.json()["errors"]

    def test_a_repeat_key_does_not_raise_it_twice(self, mait_client):
        """The app queues indents offline beside AI events and retries blindly (ADR 0003)."""
        body = {"product_type": ProductType.STRAW, "breed": "MURRAH", "qty_requested": 25}
        headers = {"HTTP_IDEMPOTENCY_KEY": "the-same-key"}

        first = mait_client.post(f"{BASE}/", body, format="json", **headers)
        second = mait_client.post(f"{BASE}/", body, format="json", **headers)

        assert first.status_code == 201
        assert second.json()["id"] == first.json()["id"]
        assert IndentRequest.objects.count() == 1

    def test_an_admin_cannot_raise_one(self, admin_client):
        """Indents come from the field, from the Mait who is short of stock."""
        response = admin_client.post(
            f"{BASE}/",
            {"product_type": ProductType.STRAW, "breed": "MURRAH", "qty_requested": 25},
            format="json",
        )
        assert response.status_code == 403


class TestReading:
    def test_a_mait_sees_only_their_own(self, mait_client, mait, db):
        stranger = Mait.objects.create(sahayak_vendor_code="SAH-IND", name="Other")
        IndentRequest.objects.create(
            mait=stranger, product_type=ProductType.STRAW, breed="GIR", qty_requested=10
        )
        IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=5
        )

        results = mait_client.get(f"{BASE}/").json()["results"]
        assert [row["breed"] for row in results] == ["MURRAH"]

    def test_an_admin_sees_everyones(self, admin_client, mait, db):
        stranger = Mait.objects.create(sahayak_vendor_code="SAH-IND2", name="Other")
        for holder in (mait, stranger):
            IndentRequest.objects.create(
                mait=holder, product_type=ProductType.STRAW, breed="GIR", qty_requested=10
            )

        assert admin_client.get(f"{BASE}/").json()["count"] == 2

    def test_stale_finds_an_approved_indent_nobody_issued(self, admin_client, mait):
        fresh = IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="GIR", qty_requested=10
        )
        old = IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.STRAW,
            breed="MURRAH",
            qty_requested=10,
            status=IndentRequest.Status.APPROVED,
        )
        # requested_at is auto_now_add, so it is pushed back after the fact.
        IndentRequest.objects.filter(pk=old.pk).update(
            requested_at=timezone.now() - timedelta(days=10)
        )

        results = admin_client.get(f"{BASE}/?stale=true").json()["results"]
        ids = [row["id"] for row in results]
        assert old.id in ids
        assert fresh.id not in ids

    def test_stale_finds_a_request_nobody_has_approved(self, admin_client, mait):
        """
        The case the filter used to miss.

        The admin dashboard counted these as stale and the list did not, so a count of four
        opened onto an empty table. Whether the office has got as far as approving it is not
        the Mait's problem — either way they asked for straws days ago and none are coming.
        """
        fresh = IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="GIR", qty_requested=10
        )
        forgotten = IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=10
        )
        IndentRequest.objects.filter(pk=forgotten.pk).update(
            requested_at=timezone.now() - timedelta(days=5)
        )

        ids = [row["id"] for row in admin_client.get(f"{BASE}/?stale=true").json()["results"]]
        assert forgotten.id in ids
        assert fresh.id not in ids

    def test_stale_leaves_out_the_ones_already_settled(self, admin_client, mait):
        """Issued and rejected are finished. Age does not make a closed request stale."""
        for state in (IndentRequest.Status.ISSUED, IndentRequest.Status.REJECTED):
            settled = IndentRequest.objects.create(
                mait=mait,
                product_type=ProductType.STRAW,
                breed="GIR",
                qty_requested=10,
                status=state,
            )
            IndentRequest.objects.filter(pk=settled.pk).update(
                requested_at=timezone.now() - timedelta(days=30)
            )

        assert admin_client.get(f"{BASE}/?stale=true").json()["count"] == 0

    def test_stale_also_finds_one_that_never_reached_indent_easy(self, admin_client, mait):
        """Synced and approved are different failures, and both leave a Mait waiting."""
        never_pushed = IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.STRAW,
            breed="GIR",
            qty_requested=10,
            sync_status=IndentRequest.SyncStatus.FAILED,
        )

        results = admin_client.get(f"{BASE}/?stale=true").json()["results"]
        assert [row["id"] for row in results] == [never_pushed.id]

    def test_anonymous_is_rejected(self):
        assert APIClient().get(f"{BASE}/").status_code == 401
