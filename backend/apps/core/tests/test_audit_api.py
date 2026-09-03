"""
Reading the audit trail (W19).

The trail has existed since the first commit; this is the first thing that can read it, and
what it must get right is not the query but the *rendering*. An audit log is only useful to
the extent a person can read a row without knowing the schema, so most of what follows pins
the sentence each action produces.

Three properties beyond that. The trail is **read-only** — an audit log with a write path is
not one. It is gated on its own section, because who may read who-opened-whose-Aadhaar-card is
the same question as who may administer accounts. And the **facets must not collapse**: a chip
list counted off the fully filtered set leaves exactly one chip the moment you use it, with no
way back.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/audit/"


@pytest.fixture
def auditor(db):
    return User.objects.create_user(
        username="auditor",
        password="pw-for-tests-only",
        full_name="Asha Verma",
        role=Role.ADMIN,
        portal_sections=[PortalSection.USERS, PortalSection.LOGS],
    )


@pytest.fixture
def client_for(db):
    def _make(user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    return _make


@pytest.fixture
def audit_client(auditor, client_for):
    return client_for(auditor)


def an_entry(**fields):
    """One trail row, placed in the past where asked."""
    minutes = fields.pop("minutes_ago", 5)
    entry = AuditLog.objects.create(
        action=fields.pop("action", AuditLog.Action.CREATE),
        entity_type=fields.pop("entity_type", "ai_event"),
        entity_id=str(fields.pop("entity_id", 1)),
        meta_json=fields.pop("meta", {}),
        **fields,
    )
    AuditLog.objects.filter(pk=entry.pk).update(
        created_at=timezone.now() - timedelta(minutes=minutes)
    )
    entry.refresh_from_db()
    return entry


def rows(response):
    return response.data["results"]


def summaries(response):
    return [row["summary"] for row in rows(response)]


# --------------------------------------------------------------------------------------
# A row is a sentence
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        # A state change says where it went, in words, rather than making the reader assemble
        # it from an action column and a JSON key.
        (
            {
                "action": AuditLog.Action.STATE_CHANGE,
                "entity_type": "ai_event",
                "entity_id": 64,
                "meta": {"to": "completed", "straw": "T0001"},
            },
            "Completed AI event 64",
        ),
        (
            {
                "action": AuditLog.Action.CREATE,
                "entity_type": "pregnancy_check",
                "entity_id": 44,
                "meta": {"due_on": "2026-12-02"},
            },
            "Created pregnancy check 44",
        ),
        (
            {
                "action": AuditLog.Action.LOGIN,
                "entity_type": "user",
                "entity_id": 1,
                "meta": {"method": "otp"},
            },
            "Signed in by otp",
        ),
        (
            {
                "action": AuditLog.Action.UPLOAD,
                "entity_type": "data_upload_log",
                "entity_id": 3,
                "meta": {"file_name": "members.xlsx", "size": 2048},
            },
            "Uploaded members.xlsx",
        ),
        # The row an auditor is scrolling for, named as plainly as it can be.
        (
            {
                "action": AuditLog.Action.PII_ACCESS,
                "entity_type": "non_member",
                "entity_id": 30,
                "meta": {"aadhaar_card_viewed": True},
            },
            "Opened the Aadhaar card on non-member 30",
        ),
        (
            {
                "action": AuditLog.Action.PII_ACCESS,
                "entity_type": "report",
                "entity_id": "mait_payment_export",
                "meta": {"month": "2026-09"},
            },
            "Exported mait payment export",
        ),
    ],
)
def test_each_action_reads_as_a_sentence(audit_client, fields, expected):
    an_entry(**fields)
    assert summaries(audit_client.get(URL)) == [expected]


def test_an_acronym_keeps_its_capitals_mid_sentence(audit_client):
    """
    "Completed ai event 64" is what a naive lowercase produces, and this platform is full of
    them — AI, MPP, SAP.
    """
    an_entry(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="ai_event",
        entity_id=7,
        meta={"to": "cancelled"},
    )
    assert "AI event" in summaries(audit_client.get(URL))[0]


def test_the_facts_do_not_repeat_the_sentence(audit_client):
    """
    A panel that says "To: completed" under a line reading "Completed AI event 64" is one
    people stop opening.
    """
    an_entry(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="ai_event",
        entity_id=64,
        meta={"to": "completed", "straw": "T0001"},
    )
    row = rows(audit_client.get(URL))[0]
    labels = [fact["label"] for fact in row["facts"]]

    assert "To" not in labels
    assert "Straw" in labels


def test_a_before_and_after_becomes_a_real_diff(audit_client):
    """
    Some call sites record one — the payout scheme editor is the clearest — and those are the
    rows where somebody wants to see exactly what moved.
    """
    an_entry(
        action=AuditLog.Action.UPDATE,
        entity_type="mait_payout_scheme",
        entity_id=1,
        meta={
            "before": {"commission_per_ai": "220.00", "fixed_min_ai": 25},
            "after": {"commission_per_ai": "250.00", "fixed_min_ai": 25},
        },
    )
    row = rows(audit_client.get(URL))[0]

    # Only what changed. An unchanged field in a diff is noise.
    assert row["changes"] == [{"field": "Commission per ai", "from": "220.00", "to": "250.00"}]
    assert row["facts"] == []


def test_a_scheduled_job_is_named_System_rather_than_left_blank(audit_client):
    """A null actor is a job, and an empty cell reads as data that went missing."""
    an_entry(actor=None)
    who = rows(audit_client.get(URL))[0]["actor"]

    assert who["name"] == "System"
    assert who["system"] is True


def test_a_person_arrives_with_initials_for_the_column_to_be_scanned_by(audit_client, auditor):
    an_entry(actor=auditor)
    who = rows(audit_client.get(URL))[0]["actor"]

    assert who["name"] == "Asha Verma"
    assert who["initials"] == "AV"


# --------------------------------------------------------------------------------------
# Facets
# --------------------------------------------------------------------------------------
def test_the_action_facets_do_not_collapse_when_one_is_chosen(audit_client):
    """
    The bug this guards. Counted off the fully filtered set, choosing "Signed in" leaves
    "Signed in" as the only chip on screen and no way back to the others.
    """
    an_entry(action=AuditLog.Action.LOGIN, entity_type="user")
    an_entry(action=AuditLog.Action.PII_ACCESS, entity_type="non_member")

    response = audit_client.get(URL, {"action": "login"})
    keys = [facet["key"] for facet in response.data["facets"]["actions"]]

    assert response.data["count"] == 1
    assert set(keys) == {"login", "pii_access"}


def test_a_facet_count_says_what_choosing_it_would_give(audit_client):
    for _ in range(3):
        an_entry(action=AuditLog.Action.LOGIN, entity_type="user")
    an_entry(action=AuditLog.Action.CREATE, entity_type="ai_event")

    facets = audit_client.get(URL).data["facets"]["actions"]
    counts = {facet["key"]: facet["count"] for facet in facets}

    assert counts == {"login": 3, "create": 1}


def test_record_types_narrow_with_the_action(audit_client):
    """The other direction: an entity facet is counted against the action filter."""
    an_entry(action=AuditLog.Action.PII_ACCESS, entity_type="non_member")
    an_entry(action=AuditLog.Action.CREATE, entity_type="ai_event")

    facets = audit_client.get(URL, {"action": "pii_access"}).data["facets"]["entity_types"]
    assert [facet["key"] for facet in facets] == ["non_member"]


# --------------------------------------------------------------------------------------
# Filters, summary and paging
# --------------------------------------------------------------------------------------
def test_the_search_finds_what_somebody_has_in_their_hand(audit_client, auditor):
    an_entry(actor=auditor, entity_type="ai_event", entity_id=99)
    an_entry(entity_type="member", entity_id=12, ip_address="10.0.0.9")

    assert audit_client.get(URL, {"search": "99"}).data["count"] == 1
    assert audit_client.get(URL, {"search": "auditor"}).data["count"] == 1
    assert audit_client.get(URL, {"search": "10.0.0.9"}).data["count"] == 1
    assert audit_client.get(URL, {"search": "member"}).data["count"] == 1


def test_the_date_range_is_inclusive_at_both_ends(audit_client):
    an_entry(minutes_ago=60 * 24 * 5)
    an_entry(minutes_ago=10)

    today = timezone.localdate().isoformat()
    assert audit_client.get(URL, {"date_from": today}).data["count"] == 1
    assert audit_client.get(URL, {"date_to": today}).data["count"] == 2


def test_the_summary_counts_personal_data_on_its_own(audit_client):
    """The obligation, not one activity among several."""
    an_entry(action=AuditLog.Action.PII_ACCESS, entity_type="non_member")
    an_entry(action=AuditLog.Action.PII_ACCESS, entity_type="report")
    an_entry(action=AuditLog.Action.LOGIN, entity_type="user")

    summary = audit_client.get(URL).data["summary"]
    assert summary["pii_access"] == 2
    assert summary["total"] == 3
    assert summary["window_days"] == 30


def test_the_summary_counts_people_rather_than_rows(audit_client, auditor):
    """One person doing forty things is one person to ask about it."""
    for _ in range(4):
        an_entry(actor=auditor)
    an_entry(actor=None)

    assert audit_client.get(URL).data["summary"]["people"] == 1


def test_paging_counts_the_trail_not_the_page(audit_client):
    for index in range(7):
        an_entry(entity_id=index)

    data = audit_client.get(URL, {"limit": 3}).data
    assert data["count"] == 7
    assert len(data["results"]) == 3
    assert data["limit"] == 3

    assert len(audit_client.get(URL, {"limit": 3, "offset": 6}).data["results"]) == 1


def test_the_page_size_is_capped(audit_client):
    assert audit_client.get(URL, {"limit": 5000}).data["limit"] == 200
    assert audit_client.get(URL, {"limit": "lots"}).data["limit"] == 50


def test_newest_first(audit_client):
    an_entry(entity_id=1, minutes_ago=60)
    an_entry(entity_id=2, minutes_ago=5)

    assert [row["entity_id"] for row in rows(audit_client.get(URL))] == ["2", "1"]


# --------------------------------------------------------------------------------------
# It is read-only, and it is gated
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_the_trail_cannot_be_written_through(audit_client, method):
    """An audit trail that can be edited is not an audit trail."""
    response = getattr(audit_client, method)(URL, {}, format="json")
    assert response.status_code == 405


def test_an_account_without_the_logs_section_is_refused(client_for, db):
    """
    Who may read the record of who opened a farmer's Aadhaar card is the same question as who
    may administer accounts. It is not granted with the rest of the portal.
    """
    user = User.objects.create_user(
        username="clerk",
        password="pw-for-tests-only",
        full_name="Rate clerk",
        role=Role.ADMIN,
        portal_sections=[PortalSection.RATES, PortalSection.REPORTS],
    )
    assert client_for(user).get(URL).status_code == 403


def test_a_mait_cannot_read_it_at_all(client_for, db):
    user = User.objects.create_user(
        username="fieldhand", full_name="Field hand", role=Role.MAIT, mobile_no="9876500000"
    )
    assert client_for(user).get(URL).status_code == 403
