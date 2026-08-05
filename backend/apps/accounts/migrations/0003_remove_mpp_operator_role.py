"""
Remove the MPP Operator role.

The business confirmed the role does not exist in the organisation, so SRS §5's entry for it
is superseded. Everything an operator would have done is an Admin action.
"""

from django.db import migrations, models


def deactivate_orphaned_operators(apps, schema_editor):
    """
    Deactivate any account still holding the removed role.

    Deliberately *not* converted to Admin. An operator was read-only by definition, and
    silently handing those accounts write access to master data and user management would be
    a privilege escalation performed by a migration — the last place anyone would look for
    one. Deactivating is reversible by a human who can check who the account belongs to.
    """
    User = apps.get_model("accounts", "User")
    orphaned = User.objects.filter(role="mpp_operator")
    count = orphaned.count()
    if count:
        orphaned.update(is_active=False)
        print(
            f"\n  Deactivated {count} account(s) holding the removed 'mpp_operator' role. "
            "Recreate them as Admin if they are still needed."
        )


def noop(apps, schema_editor):
    """The role no longer exists, so there is nothing faithful to restore."""


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_initial"),
    ]

    operations = [
        migrations.RunPython(deactivate_orphaned_operators, noop),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("super_admin", "Super Admin"),
                    ("admin", "Admin / Back-office"),
                    ("mait", "Mait (Field Agent)"),
                ],
                db_index=True,
                max_length=20,
            ),
        ),
        migrations.DeleteModel(
            name="MPPOperatorAssignment",
        ),
    ]
