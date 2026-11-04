"""
Give the OTP pipeline to the accounts that hand out Super OTP codes.

The pipeline is the evidence that desk decides on — whether a code reached the phone at all —
so it goes to holders of Super OTP, placed directly after it, and to nobody else by default. A
new `PortalSection` is invisible until somebody's list contains it.
"""

from django.db import migrations

SECTION = "otp-pipeline"
SOURCE = "super-otp"


def grant(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(role__in=["admin", "normal_user", "super_admin"]):
        sections = user.portal_sections or []
        if SOURCE in sections and SECTION not in sections:
            sections.insert(sections.index(SOURCE) + 1, SECTION)
            user.portal_sections = sections
            user.save(update_fields=["portal_sections"])


def revoke(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(role__in=["admin", "normal_user", "super_admin"]):
        sections = user.portal_sections or []
        if SECTION in sections:
            user.portal_sections = [s for s in sections if s != SECTION]
            user.save(update_fields=["portal_sections"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0014_alter_user_role")]

    operations = [migrations.RunPython(grant, revoke)]
