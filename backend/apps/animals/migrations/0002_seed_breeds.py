"""
Seed the breed list.

**Provisional.** SRS §18.2 item 1 still lists "confirm the authoritative breed list per
animal type" as open with the business. These are the breeds named in SRS §6.3 plus the ones
common in the region, so the picker is usable now.

Seeded as data rather than hardcoded precisely because it is provisional: an admin edits the
table, no deploy required. The migration only creates what is missing, so it will not undo
anything the business has since corrected.
"""

from django.db import migrations

COW = [
    ("GIR", "Gir", "गिर"),
    ("SAHIWAL", "Sahiwal", "साहीवाल"),
    ("HF", "H.F.", "एच.एफ."),
    ("JERSEY", "Jersey", "जर्सी"),
    ("HF_CROSS", "H.F. Cross", "एच.एफ. क्रॉस"),
    ("JERSEY_CROSS", "Jersey Cross", "जर्सी क्रॉस"),
    ("THARPARKAR", "Tharparkar", "थारपारकर"),
    ("RED_SINDHI", "Red Sindhi", "लाल सिंधी"),
    ("HARIANA", "Hariana", "हरियाणा"),
    ("NON_DESCRIPT_COW", "Non-descript", "देसी"),
]

BUFFALO = [
    ("MURRAH", "Murrah", "मुर्रा"),
    ("JAFRABADI", "Jafrabadi", "जाफराबादी"),
    ("MEHSANA", "Mehsana", "मेहसाणा"),
    ("SURTI", "Surti", "सुरती"),
    ("NILI_RAVI", "Nili-Ravi", "नीली-रावी"),
    ("BHADAWARI", "Bhadawari", "भदावरी",),
    ("NON_DESCRIPT_BUFF", "Non-descript", "देसी"),
]


def seed(apps, schema_editor):
    BreedConfig = apps.get_model("animals", "BreedConfig")

    rows = [("COW", *b) for b in COW] + [("BUFF", *b) for b in BUFFALO]
    for order, (animal_type, code, name, name_hi) in enumerate(rows, start=1):
        BreedConfig.objects.get_or_create(
            animal_type=animal_type,
            code=code,
            defaults={
                "name": name,
                "name_hi": name_hi,
                # "Non-descript" sorts last: it is the fallback, and putting it at the top
                # of a list makes it the accidental default.
                "display_order": 999 if code.startswith("NON_DESCRIPT") else order,
                "is_active": True,
            },
        )


def unseed(apps, schema_editor):
    """
    Remove only the seeded codes.

    Anything the business added afterwards is theirs and stays. Reversing a migration should
    not take real data with it.
    """
    BreedConfig = apps.get_model("animals", "BreedConfig")
    codes = [b[0] for b in COW] + [b[0] for b in BUFFALO]
    BreedConfig.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("animals", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
