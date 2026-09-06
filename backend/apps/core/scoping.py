"""
Narrowing what an account sees to the zones it was given.

One module, because a zone filter written twice is a zone filter that disagrees with itself
the first time either copy is touched — and the way it disagrees is that somebody sees a
neighbouring zone's members. Every screen that answers "how much" or "who" goes through
here; the exception queues deliberately do not (see ``docs/API_CONTRACT.md``).

The rule is always the same and lives in ``User.zone_scope``: ``None`` is the whole network,
a list is the plant codes that account may see, and an empty list is a real answer meaning
nothing at all. What differs per screen is only the path from the row to its plant — an AI
event reaches it as ``mpp__plant_code``, a pregnancy check as ``ai_event__mpp__plant_code``
— so that path is the argument.
"""

from __future__ import annotations


def scope_of(request) -> list[str] | None:
    """
    The plant codes behind this request, or ``None`` for unrestricted.

    Worked out once per request and kept on it. ``User.zone_scope`` is two queries — the
    account's zones, then the plants in them — and the dashboard alone would ask five times
    over: the summary counts, the pregnancy roll-up, the scope note, and each list it fans out
    to. Ten queries for an answer that cannot change inside one request, on the one screen
    with a 400ms budget.

    Cached on the request rather than on the user, because a user object outlives a request in
    a worker and an account whose zones have just been changed must not keep the old scope for
    the life of the process — which is the failure mode where somebody sees a zone they were
    removed from.
    """
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return None
    if not hasattr(request, "_zone_scope"):
        request._zone_scope = user.zone_scope
    return request._zone_scope


def apply_scope(queryset, request, path: str = "mpp__plant_code"):
    """
    Narrow ``queryset`` to the plants this account may see.

    ``path`` is the lookup from this model to the plant code. It is required to be spelled
    out rather than guessed from the model, because guessing wrong here does not raise — it
    silently returns everything, which is the failure nobody notices.
    """
    codes = scope_of(request)
    if codes is None:
        return queryset
    return queryset.filter(**{f"{path}__in": codes})


def scope_note(request) -> dict:
    """
    What the scope is, for the response to say so out loud.

    Every scoped endpoint returns this. A figure that has been narrowed and does not admit it
    is worse than no figure: an area manager reads 412 inseminations, repeats it in a meeting
    as the network total, and nothing on the screen ever said otherwise. The portal draws it
    as a line under the page title.
    """
    user = getattr(request, "user", None)
    codes = scope_of(request)
    if codes is None:
        return {"scoped": False, "zones": [], "plant_codes": None}
    return {
        "scoped": True,
        "zones": user.zone_names,
        "plant_codes": list(codes),
    }
