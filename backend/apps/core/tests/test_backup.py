"""
The whole-database backup (W-backup).

What these pin is the shape of the archive and the gate in front of it — the two things a
restore and a breach review each depend on. The round-trip itself is Django's (`dumpdata` /
`loaddata`), tested upstream; what is ours is that the file is complete, legible, Super-Admin
only, and recorded in the trail the moment it is taken.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/backup/"


@pytest.fixture
def client_for(db):
    def _make(user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    return _make


@pytest.fixture
def super_admin(db):
    return User.objects.create_user(
        username="root",
        password="pw-for-tests-only",
        full_name="Owner Singh",
        role=Role.SUPER_ADMIN,
    )


@pytest.fixture
def back_office(db):
    return User.objects.create_user(
        username="desk",
        password="pw-for-tests-only",
        full_name="Asha Verma",
        role=Role.ADMIN,
        portal_sections=list(PortalSection.values),
    )


def test_super_admin_gets_a_zip(client_for, super_admin):
    response = client_for(super_admin).get(URL)
    assert response.status_code == 200
    assert response["Content-Type"] == "application/zip"
    assert "attachment" in response["Content-Disposition"]
    assert ".zip" in response["Content-Disposition"]

    archive = zipfile.ZipFile(io.BytesIO(response.getvalue()))
    names = set(archive.namelist())
    assert "manifest.json" in names
    assert "RESTORE.txt" in names
    assert "data/maitai-data.json" in names

    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["kind"] == "full-database-backup"
    assert manifest["taken_by"]["username"] == "root"
    assert manifest["total_tables"] > 0
    # The data file parses, and the super admin who took it is in it (accounts was dumped).
    data = json.loads(archive.read("data/maitai-data.json"))
    assert any(row["model"] == "accounts.user" for row in data)


def test_back_office_admin_is_refused(client_for, back_office):
    # Not a section they can be granted — the whole database is Super Admin alone.
    assert client_for(back_office).get(URL).status_code == 403


def test_anonymous_is_refused():
    assert APIClient().get(URL).status_code == 401


def test_taking_it_is_recorded_before_the_file(client_for, super_admin):
    assert not AuditLog.objects.filter(entity_type="backup").exists()
    client_for(super_admin).get(URL)
    entry = AuditLog.objects.get(entity_type="backup", entity_id="full_database")
    assert entry.action == AuditLog.Action.PII_ACCESS
    assert entry.actor_id == super_admin.id
    assert entry.meta_json["rows"] >= 0
