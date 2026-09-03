"""
Give the audit log to the accounts that administer accounts.

A new `PortalSection` value is not a schema change — `portal_sections` is a JSON list — but it
is invisible until somebody's list contains it, and an admin would otherwise find the screen
refusing them with no explanation.

Granted to holders of `users`, and to nobody else. The trail records who read a farmer's
Aadhaar card and who took a workbook of bank details out of the building; who may read *that*
is the same question as who may administer accounts, and it is not a decision to widen
quietly on everyone's behalf.
"""

from django.db import migrations

SECTION = "logs"
SOURCE = "users"


def grant(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(role__in=["admin", "super_admin"]):
        sections = user.portal_sections or []
        if SOURCE in sections and SECTION not in sections:
            sections.insert(sections.index(SOURCE) + 1, SECTION)
            user.portal_sections = sections
            user.save(update_fields=["portal_sections"])


def revoke(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(portal_sections__contains=SECTION):
        user.portal_sections = [s for s in (user.portal_sections or []) if s != SECTION]
        user.save(update_fields=["portal_sections"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0005_mait_payment_section")]

    operations = [migrations.RunPython(grant, revoke)]
