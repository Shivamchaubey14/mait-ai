"""
What one insemination costs (SRS §6.5).

The price is admin data, never a constant in a build. It lives on the breed, alongside the
labels and the ordering, and it is set from the portal — so a dairy that changes what it
charges changes it in one place and every handset picks it up on the next request.

**Two prices, one service.** A member is charged one rate and a non-member another, because
they are settled in different worlds: a member's is taken out of a milk payment the dairy
already owes her, a non-member's is cash handed to a Mait in a yard. Keeping them apart is
what lets the dairy price them apart, which it does.
"""

from __future__ import annotations

from decimal import Decimal

from apps.animals.models import BreedConfig


def price_for(*, breed: str, animal_type: str, owner_type: str) -> Decimal | None:
    """
    The rate for this insemination, or ``None`` when nobody has set one.

    ``None`` is not zero. A rate the administrator has never entered must not reach a farmer
    as "free" — the app says the service is chargeable without naming a figure, and the
    dairy's back office is the one that has to fill the gap.
    """
    # Keyed on the straw's breed, and only *preferring* the animal's species — the rate belongs
    # to the semen, not to the cow it goes into. Keying on the animal's species left a buffalo
    # straw used on a cow with no price at all: there is no COW/MURRAH row to find, and the
    # screen told a Mait the breed was unpriced when the dairy had priced it perfectly well.
    candidates = BreedConfig.objects.filter(code=(breed or "").strip().upper())
    config = (
        candidates.filter(animal_type=animal_type).order_by("-is_active").first()
        or candidates.order_by("-is_active").first()
    )
    if config is None:
        return None

    rate = config.rate if owner_type == "member" else config.non_member_rate
    return rate if rate and rate > 0 else None
