"""
Give the new Mait payment section to whoever already ran the reports.

A new `PortalSection` value is not a schema change — `portal_sections` is a JSON list — but it
is invisible until somebody's list contains it, and an admin who has always produced this
report by hand would sign in to find the screen refusing them with no explanation.

Granted to accounts holding `reports`, because that is the desk this work was already being
done at. Not to every admin: the file carries bank account numbers, and quietly widening who
can produce one is exactly the kind of thing a migration should not do on its own.
"""

from django.db import migrations

SECTION = "mait-payment"
SOURCE = "reports"


def grant(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(role__in=["admin", "super_admin"]):
        sections = user.portal_sections or []
        if SOURCE in sections and SECTION not in sections:
            # Kept next to the section it was inherited from, so the Users & roles editor
            # lists it where an operator expects to find it.
            sections.insert(sections.index(SOURCE) + 1, SECTION)
            user.portal_sections = sections
            user.save(update_fields=["portal_sections"])


def revoke(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(portal_sections__contains=SECTION):
        user.portal_sections = [s for s in (user.portal_sections or []) if s != SECTION]
        user.save(update_fields=["portal_sections"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0004_user_portal_sections")]

    operations = [migrations.RunPython(grant, revoke)]
