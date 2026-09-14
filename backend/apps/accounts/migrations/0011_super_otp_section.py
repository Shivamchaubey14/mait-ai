"""
Give the Login codes screen to the accounts that administer accounts.

Generating a code that signs somebody in without their SMS is account administration — the
same trust as Users & roles — so it goes to holders of that section and nobody else by default.
A new `PortalSection` is invisible until somebody's list contains it.
"""

from django.db import migrations

SECTION = "super-otp"
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
    for user in User.objects.filter(role__in=["admin", "super_admin"]):
        sections = user.portal_sections or []
        if SECTION in sections:
            user.portal_sections = [s for s in sections if s != SECTION]
            user.save(update_fields=["portal_sections"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0010_super_otp")]

    operations = [migrations.RunPython(grant, revoke)]
