"""
Where a non-member's Aadhaar card images go.

The mechanics live in ``apps.core.storage``, the same call an animal portrait and a proof
photo go through, so the three cannot drift apart. What is kept here is the prefix these are
filed under and the record they are keyed to.

**These are the most sensitive files this product writes.** A proof photo shows a cow in a
yard; this is a government identity document. Two consequences, both enforced elsewhere and
recorded here so the reason travels with the code:

- The path is derived from the record, never from the uploaded filename (``core.storage``),
  so nothing a handset sends can name the location.
- The URL is never returned to a handset. ``NonMemberSerializer`` answers with a boolean
  saying whether each face has been captured, because a Mait needs to know the step is done
  and does not need a link to somebody's identity card sitting in their app's cache.
"""

from __future__ import annotations

from apps.core.storage import store_image

PREFIX = "aadhaar-cards"


def store_aadhaar_image(non_member, uploaded_file, *, face: str) -> str:
    """`aadhaar-cards/2026/08/<non-member-id>/<random>.jpg`, and the URL to record."""
    return store_image(
        uploaded_file,
        prefix=f"{PREFIX}/{face}",
        key=non_member.id,
        when=non_member.created_at,
    )
