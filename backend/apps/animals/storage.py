"""
Where an animal's portrait goes.

The mechanics live in ``apps.core.storage`` — a proof photo is written the same way and the
two must not drift apart. What is kept here is the prefix a portrait is filed under, and the
animal it is keyed to.
"""

from __future__ import annotations

from apps.core.storage import store_image

PREFIX = "animal-photos"


def store_animal_photo(animal, uploaded_file) -> str:
    """`animal-photos/2026/08/<animal-id>/<random>.jpg`, and the URL to record on the row."""
    return store_image(uploaded_file, prefix=PREFIX, key=animal.id, when=animal.created_at)
