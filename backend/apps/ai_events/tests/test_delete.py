"""
Deleting AI events (admin only).

A field user can never delete their own history — the record is the one thing an insemination
leaves behind, and the audit trail is what a dispute is settled from. Deletion is a back-office
correction (a test row, a duplicate, an event against the wrong farmer), so it is gated to an
admin, it takes the payment and the attached records with it, and every deletion is itself
written to the audit log.
"""

from __future__ import annotations

import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.core.models import AuditLog
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def mait_client(mait):
    return auth(mait.user)


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-ai-delete",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


@pytest.fixture
def normal_user_client(db):
    """A Normal User holding the AI events section — an office account that works the screen as
    an admin does, but must not be able to delete."""
    user = User.objects.create_user(
        username="normal-ai",
        password="a-long-enough-password",
        full_name="Normal User",
        role=Role.NORMAL_USER,
    )
    return auth(user)


def _event(mait, mpp, member, animal, status=AIEvent.Status.DRAFT):
    return AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=animal,
        status=status,
    )


class TestSingleDelete:
    def test_admin_deletes_an_event(self, admin_client, mait, mpp, member, animal):
        event = _event(mait, mpp, member, animal)

        response = admin_client.delete(f"{BASE}/{event.id}/")

        assert response.status_code == 204
        assert not AIEvent.objects.filter(id=event.id).exists()

    def test_the_deletion_is_audited(self, admin_client, mait, mpp, member, animal):
        event = _event(mait, mpp, member, animal)
        event_id = event.id

        admin_client.delete(f"{BASE}/{event_id}/")

        entry = AuditLog.objects.get(entity_type="ai_event", entity_id=event_id)
        assert entry.action == AuditLog.Action.DELETE
        # The Mait's code survives the row it named, so the log answers whose event it was.
        assert entry.meta_json["mait_code"] == mait.sahayak_vendor_code

    def test_it_takes_the_payment_with_it(self, admin_client, ai_event_ready_to_complete):
        event, _ = ai_event_ready_to_complete()
        assert Payment.objects.filter(ai_event=event).exists()

        response = admin_client.delete(f"{BASE}/{event.id}/")

        assert response.status_code == 204
        assert not AIEvent.objects.filter(id=event.id).exists()
        # PROTECT on the payment would block the delete if it were not removed in the same
        # transaction; the money it carried is preserved in the audit entry instead.
        assert not Payment.objects.filter(ai_event_id=event.id).exists()
        entry = AuditLog.objects.get(entity_type="ai_event", entity_id=event.id)
        assert entry.meta_json["payment"]["amount"] == "250.00"


class TestPermissions:
    def test_a_mait_cannot_delete_their_own_event(self, mait_client, mait, mpp, member, animal):
        event = _event(mait, mpp, member, animal)

        assert mait_client.delete(f"{BASE}/{event.id}/").status_code == 403
        assert AIEvent.objects.filter(id=event.id).exists()

    def test_a_mait_cannot_bulk_delete(self, mait_client, mait, mpp, member, animal):
        event = _event(mait, mpp, member, animal)

        response = mait_client.post(f"{BASE}/bulk-delete/", {"ids": [event.id]}, format="json")

        assert response.status_code == 403
        assert AIEvent.objects.filter(id=event.id).exists()

    def test_anonymous_is_rejected(self, mait, mpp, member, animal):
        event = _event(mait, mpp, member, animal)
        assert APIClient().delete(f"{BASE}/{event.id}/").status_code == 401

    def test_a_normal_user_cannot_delete(self, normal_user_client, mait, mpp, member, animal):
        # The one thing the Normal User role exists to withhold. Reaches the endpoint as an
        # admin does, but deletion is refused.
        event = _event(mait, mpp, member, animal)

        assert normal_user_client.delete(f"{BASE}/{event.id}/").status_code == 403
        assert AIEvent.objects.filter(id=event.id).exists()

    def test_a_normal_user_cannot_bulk_delete(
        self, normal_user_client, mait, mpp, member, animal
    ):
        event = _event(mait, mpp, member, animal)

        response = normal_user_client.post(
            f"{BASE}/bulk-delete/", {"ids": [event.id]}, format="json"
        )

        assert response.status_code == 403
        assert AIEvent.objects.filter(id=event.id).exists()

    def test_a_normal_user_can_still_see_the_events(
        self, normal_user_client, mait, mpp, member, animal
    ):
        # Everywhere but delete it is an admin: it sees the whole list, not an empty one.
        event = _event(mait, mpp, member, animal)

        response = normal_user_client.get(f"{BASE}/")

        assert response.status_code == 200
        assert any(row["id"] == event.id for row in response.json()["results"])


class TestBulkDelete:
    def test_removes_every_selected_event(self, admin_client, mait, mpp, member, animal):
        ids = [_event(mait, mpp, member, animal).id for _ in range(3)]

        response = admin_client.post(f"{BASE}/bulk-delete/", {"ids": ids}, format="json")

        assert response.status_code == 200
        assert response.json()["deleted_count"] == 3
        assert sorted(response.json()["deleted"]) == sorted(ids)
        assert not AIEvent.objects.filter(id__in=ids).exists()

    def test_reports_ids_it_could_not_find(self, admin_client, mait, mpp, member, animal):
        real = _event(mait, mpp, member, animal).id
        ghost = real + 10_000

        response = admin_client.post(
            f"{BASE}/bulk-delete/", {"ids": [real, ghost]}, format="json"
        )

        body = response.json()
        assert body["deleted"] == [real]
        assert body["missing"] == [ghost]

    def test_each_deletion_leaves_its_own_audit_entry(
        self, admin_client, mait, mpp, member, animal
    ):
        ids = [_event(mait, mpp, member, animal).id for _ in range(2)]

        admin_client.post(f"{BASE}/bulk-delete/", {"ids": ids}, format="json")

        logged = AuditLog.objects.filter(
            entity_type="ai_event", action=AuditLog.Action.DELETE, entity_id__in=ids
        ).count()
        assert logged == 2

    def test_an_empty_selection_is_rejected(self, admin_client):
        assert admin_client.post(f"{BASE}/bulk-delete/", {"ids": []}, format="json").status_code == 400
