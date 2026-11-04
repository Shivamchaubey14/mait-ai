"""
Call a non-descript breed "नहीं पता" in Hindi.

It was seeded as "देसी", which reads as a breed of its own — a local one — when what the row
means is that nobody knows the breed. A Mait registering an animal of unknown breed was being
asked to name it as something.

Only rows still carrying the seeded name are changed, so a name an admin has since set on the
portal's Products screen is left as it is. Going back puts the seeded name on rows that still
carry this one, for the same reason.
"""

from django.db import migrations

CODES = ("NON_DESCRIPT_COW", "NON_DESCRIPT_BUFF")
SEEDED = "देसी"
UNKNOWN = "नहीं पता"


def rename(apps, schema_editor):
    BreedConfig = apps.get_model("animals", "BreedConfig")
    BreedConfig.objects.filter(code__in=CODES, name_hi=SEEDED).update(name_hi=UNKNOWN)


def restore(apps, schema_editor):
    BreedConfig = apps.get_model("animals", "BreedConfig")
    BreedConfig.objects.filter(code__in=CODES, name_hi=UNKNOWN).update(name_hi=SEEDED)


class Migration(migrations.Migration):

    dependencies = [
        ("animals", "0007_animal_client_uuid"),
    ]

    operations = [migrations.RunPython(rename, restore)]
