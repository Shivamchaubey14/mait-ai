"""
Give the Stores screen to the accounts that set up zones.

A new `PortalSection` value is invisible until somebody's list contains it. Which depot serves
which BMC/MCCs is the same kind of decision as which zone a BMC/MCC sits in — the shape of the
network, made once and changed rarely — so it goes to the desk that already makes that one,
and to nobody else by default.
"""

from django.db import migrations

SECTION = "stores"
SOURCE = "zones"


def grant(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(role__in=["admin", "super_admin"]):
        sections = user.portal_sections or []
        if SOURCE in sections and SECTION not in sections:
            sections.append(SECTION)
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
    dependencies = [("accounts", "0008_user_store_alter_user_role")]

    operations = [migrations.RunPython(grant, revoke)]
