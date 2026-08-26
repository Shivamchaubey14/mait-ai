"""
Per-account portal access (SRS §6.8.3).

The backfill matters more than the field. Every Admin that exists today reaches all
seventeen screens, and shipping an empty list would sign them in to a portal with an empty
sidebar — so they are given the full set and an operator narrows it from Users & roles.
"""

from django.db import migrations, models


def grant_everything_to_existing_admins(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    from apps.accounts.models import PortalSection

    User.objects.filter(role__in=["admin", "super_admin"]).update(
        portal_sections=list(PortalSection.values)
    )


def clear(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.update(portal_sections=[])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_remove_mpp_operator_role")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="portal_sections",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text=(
                    "Which admin-portal sections this account may open. Applies to Admins "
                    "only — a Super Admin reaches everything and a Mait has no portal."
                ),
            ),
        ),
        migrations.RunPython(grant_everything_to_existing_admins, clear),
    ]
