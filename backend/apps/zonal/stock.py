"""
The zone's stock, grouped the way a manager thinks about it: by place.

A zone *is* a set of chilling centres, and "who is about to run out" is a question about a
place before it is a question about a person — a manager works out which way to drive, then
who to ring when they get there. So the first cut is by BMC/MCC: what is held under it, how
many of its Maits are empty, and which depot could fix that.

**Each Mait lands in exactly one location.** A Mait can cover collection points reporting into
two centres, and counting their straws under both would make the locations sum to more than
the zone total — a screen whose rows do not add up to the tile above them is one nobody can
reconcile. So a Mait is placed at the centre most of their points report into, ties to the
lower code so the answer does not move between two calls, and the others are named on the row
as `also_covers`. It is the same rule `stores.services.store_for_mait` uses to route an
indent, for the same reason.

**By product, too.** Straws are the figure that stops work, and the places, Maits and depots
count straws. But a manager also answers for sheaths, gloves, liquid nitrogen and the kit a
Mait carries, and asks of each the same three questions: how much is out with the Maits, how
much is on the depot shelves, and **what is on its way** — asked and not yet agreed, agreed and
waiting at the depot, packed and waiting to be collected. ``products`` answers them per item,
grouped the way the catalogue is: straws by breed, consumables, and equipment.

The per-Mait and per-depot figures are read exactly as `apps.inventory.views.inventory_oversight`
reads them — the same `MaitInventory` rows and the same `stores.services.availability` — so a
manager's handset and the portal's Inventory screen cannot come to disagree about who is at
zero.
"""

from __future__ import annotations

from collections import Counter

from django.conf import settings
from django.db.models import Q

from apps.indents.models import IndentRequest
from apps.inventory.models import Consumable, MaitInventory, ProductType, SemenBatch
from apps.masterdata.models import MPP, Mait
from apps.stores.models import Store
from apps.stores.serializers import ItemNames
from apps.stores.services import availability, item_of

#: A location with no name in the master data is still a location. Shown by its code rather
#: than left blank, which reads as a row that failed to load.
UNPLACED = "Not at a BMC/MCC"


def _primary_plant(codes_covered: Counter, in_zone: set[str] | None) -> str:
    """
    The one centre a Mait is counted under.

    Most collection points wins; ties go to the lower code, so two calls place them the same
    way. Restricted to the zone first — a Mait straddling the boundary belongs, on this
    screen, to the half of their round that is actually the manager's.
    """
    wanted = {
        code: count
        for code, count in codes_covered.items()
        if code and (in_zone is None or code in in_zone)
    }
    if not wanted:
        return ""
    # Most points first, then the lower code — `min` over a negated count, so the tie-break
    # reads as "smallest code" rather than as an inverted string comparison.
    return min(wanted, key=lambda code: (-wanted[code], code))


def _straws_by_mait(mait_ids: list[int]) -> tuple[dict[int, int], dict[int, dict[str, int]]]:
    """Total straws and the breakdown by breed, for every Mait in the zone."""
    if not mait_ids:
        return {}, {}

    lines = list(
        MaitInventory.objects.filter(
            mait_id__in=mait_ids, product_type=ProductType.STRAW, qty_available__gt=0
        )
    )
    breeds = {
        batch.id: batch.breed
        for batch in SemenBatch.objects.filter(id__in=[line.product_ref_id for line in lines])
    }

    totals: dict[int, int] = {}
    by_breed: dict[int, dict[str, int]] = {}
    for line in lines:
        totals[line.mait_id] = totals.get(line.mait_id, 0) + line.qty_available
        breed = breeds.get(line.product_ref_id, "unknown")
        holder = by_breed.setdefault(line.mait_id, {})
        holder[breed] = holder.get(breed, 0) + line.qty_available
    return totals, by_breed


def _shelves(codes: list[str] | None) -> list[dict]:
    """
    Every open depot in reach, and what it can still promise.

    In reach means it serves one of the zone's centres or has been put in the zone outright —
    a depot still being set up serves nothing yet and must not vanish from the manager who is
    setting it up. The same rule the portal's Inventory screen applies.
    """
    stores = Store.objects.filter(is_active=True).select_related("zone").prefetch_related("plants")
    if codes is not None:
        stores = stores.filter(
            Q(plants__plant_code__in=codes) | Q(zone__plants__plant_code__in=codes)
        ).distinct()

    from apps.stores.services import open_indents

    shelves = []
    for store in stores.order_by("name"):
        shelf = availability(store)
        whole = shelf
        straws = {item: line for item, line in shelf.items() if item[0] == ProductType.STRAW}
        shelves.append(
            {
                "id": store.id,
                "code": store.code,
                "name": store.name,
                "plant_codes": [plant.plant_code for plant in store.plants.all()],
                "plant_names": [
                    plant.plant_name or plant.plant_code for plant in store.plants.all()
                ],
                "straws_on_hand": sum(line["on_hand"] for line in straws.values()),
                "straws_set_aside": sum(line["set_aside"] for line in straws.values()),
                "straws_available": sum(line["available"] for line in straws.values()),
                "by_breed": {
                    item[1]: line["available"] for item, line in straws.items() if line["available"]
                },
                "open_indents": open_indents(store).count(),
                # Every item, for the product view. Dropped from the response in `build`.
                "_shelf": whole,
            }
        )
    return shelves


#: How a catalogue product is grouped: the catalogue's own two kinds.
CATEGORIES = ("straw", "consumable", "asset")


def _products(maits: list, shelves: list[dict], codes: list[str] | None) -> dict:
    """
    Every item in the zone, by category: where it is, and what is on its way.

    Keyed the way ``item_of`` keys an indent — a breed for a straw, a catalogue id for
    everything else — so the Maits' balances, the depots' shelves and the open indents all
    meet on the same item. Every active catalogue product is listed even when nobody holds
    any, because *nobody in the zone has gloves* is exactly the line a manager is looking for.
    """
    names = ItemNames()
    catalogue = {
        row.id: row for row in Consumable.objects.filter(is_active=True).order_by("display_order")
    }

    rows: dict[tuple, dict] = {}

    def row_for(item: tuple) -> dict | None:
        product_type, breed, ref = item
        if product_type == ProductType.STRAW:
            category = "straw"
        else:
            product = catalogue.get(int(ref or 0))
            if product is None:
                # Retired from the catalogue: nothing to name it by, and nothing to restock.
                return None
            category = product.category
        if item not in rows:
            rows[item] = {
                "key": f"{product_type}:{breed or ref}",
                "category": category,
                "name": names.name(product_type, breed, ref),
                "name_hi": names.name_hi(product_type, breed),
                "unit": names.unit(product_type, ref) or "",
                "with_maits": 0,
                "maits_holding": 0,
                "at_depots": 0,
                "set_aside": 0,
                "free": 0,
                "requested": 0,
                "approved": 0,
            }
        return rows[item]

    for product in catalogue.values():
        row_for((ProductType.CONSUMABLE, "", product.id))

    # -- with the Maits ---------------------------------------------------------------------
    mait_ids = [mait.id for mait in maits]
    lines = list(MaitInventory.objects.filter(mait_id__in=mait_ids, qty_available__gt=0))
    breeds = {
        batch.id: batch.breed
        for batch in SemenBatch.objects.filter(
            id__in=[line.product_ref_id for line in lines if line.product_type == ProductType.STRAW]
        )
    }
    holders: dict[tuple, set] = {}
    for line in lines:
        if line.product_type == ProductType.STRAW:
            item = (ProductType.STRAW, breeds.get(line.product_ref_id, "unknown"), 0)
        else:
            item = (line.product_type, "", int(line.product_ref_id or 0))
        row = row_for(item)
        if row is None:
            continue
        row["with_maits"] += line.qty_available
        holders.setdefault(item, set()).add(line.mait_id)
    for item, who in holders.items():
        rows[item]["maits_holding"] = len(who)

    # -- on the depot shelves -----------------------------------------------------------------
    for shelf in shelves:
        for item, line in shelf["_shelf"].items():
            row = row_for(item)
            if row is None:
                continue
            row["at_depots"] += line["on_hand"]
            row["set_aside"] += line["set_aside"]
            row["free"] += line["available"]

    # -- on its way -----------------------------------------------------------------------------
    indents = IndentRequest.objects.filter(
        status__in=[IndentRequest.Status.REQUESTED, IndentRequest.Status.APPROVED]
    )
    if codes is not None:
        indents = indents.filter(mait__mpps__plant_code__in=codes).distinct()
    for indent in indents:
        row = row_for(item_of(indent))
        if row is None:
            continue
        if indent.status == IndentRequest.Status.REQUESTED:
            row["requested"] += indent.qty_requested
        else:
            # What the depot still owes on it, less what is already packed and counted as
            # set aside — the same straws are not on their way twice.
            row["approved"] += indent.qty_open

    grouped: dict[str, list[dict]] = {category: [] for category in CATEGORIES}
    for row in rows.values():
        grouped.setdefault(row["category"], []).append(row)
    for items in grouped.values():
        # What is with the Maits and on the shelves first; a line of zeros last.
        items.sort(key=lambda row: (-(row["with_maits"] + row["at_depots"]), row["name"]))
    return grouped


def build(codes: list[str] | None) -> dict:
    """The stock screen's whole answer: the zone, its locations, its Maits and its depots."""
    in_zone = set(codes) if codes is not None else None

    maits = Mait.objects.filter(is_active=True)
    if codes is not None:
        maits = maits.filter(mpps__plant_code__in=codes).distinct()
    maits = list(maits.prefetch_related("mpps"))

    totals, by_breed = _straws_by_mait([mait.id for mait in maits])
    threshold = settings.LOW_STOCK_THRESHOLD

    # The names the master data has for each centre, so a location row reads as a place
    # rather than as a code. There is no plant master — the name rides on every MPP row.
    plant_names = {
        row["plant_code"]: row["plant_name"]
        for row in MPP.objects.exclude(plant_code="").values("plant_code", "plant_name")
    }

    mait_rows = []
    for mait in maits:
        covered = Counter(mpp.plant_code for mpp in mait.mpps.all() if mpp.plant_code)
        primary = _primary_plant(covered, in_zone)
        total = totals.get(mait.id, 0)
        mait_rows.append(
            {
                "mait_id": mait.id,
                "name": mait.name,
                "code": mait.sahayak_vendor_code or "",
                "mobile_no": mait.mobile_no or "",
                "plant_code": primary,
                "plant_name": plant_names.get(primary, "") or primary,
                # Named rather than counted: a manager looking at an empty Mait wants to know
                # whether the next centre along is also theirs.
                "also_covers": sorted(
                    plant_names.get(code, "") or code
                    for code in covered
                    if code != primary and (in_zone is None or code in in_zone)
                ),
                "mpps": len(covered),
                "total": total,
                "by_breed": by_breed.get(mait.id, {}),
                "state": "at_zero" if total == 0 else "low" if total <= threshold else "ok",
            }
        )
    # Emptiest first. The list is read to find who has stopped, not to admire who has plenty.
    mait_rows.sort(key=lambda row: (row["total"], row["name"]))

    shelves = _shelves(codes)
    products = _products(maits, shelves, codes)
    by_plant: dict[str, list[dict]] = {}
    for shelf in shelves:
        for code in shelf["plant_codes"]:
            by_plant.setdefault(code, []).append(shelf)

    locations: dict[str, dict] = {}
    for row in mait_rows:
        code = row["plant_code"]
        place = locations.setdefault(
            code,
            {
                "plant_code": code,
                "name": (plant_names.get(code, "") or code) if code else UNPLACED,
                "maits": 0,
                "at_zero": 0,
                "low": 0,
                "straws": 0,
                "by_breed": {},
                "stores": [],
            },
        )
        place["maits"] += 1
        place["straws"] += row["total"]
        if row["state"] == "at_zero":
            place["at_zero"] += 1
        elif row["state"] == "low":
            place["low"] += 1
        for breed, qty in row["by_breed"].items():
            place["by_breed"][breed] = place["by_breed"].get(breed, 0) + qty

    # A centre in the zone with nobody working it is still a centre, and its absence from this
    # list is the kind of gap somebody has to notice rather than infer.
    for code in in_zone or []:
        locations.setdefault(
            code,
            {
                "plant_code": code,
                "name": plant_names.get(code, "") or code,
                "maits": 0,
                "at_zero": 0,
                "low": 0,
                "straws": 0,
                "by_breed": {},
                "stores": [],
            },
        )

    for code, place in locations.items():
        place["stores"] = [
            {
                "id": shelf["id"],
                "name": shelf["name"],
                "straws_available": shelf["straws_available"],
                "open_indents": shelf["open_indents"],
            }
            for shelf in by_plant.get(code, [])
        ]

    # Where the trouble is, first: most Maits at zero, then emptiest, then by name.
    location_rows = sorted(
        locations.values(),
        key=lambda place: (-place["at_zero"], place["straws"], place["name"]),
    )

    return {
        "summary": {
            "total_straws": sum(row["total"] for row in mait_rows),
            "maits": len(mait_rows),
            "at_zero": sum(1 for row in mait_rows if row["state"] == "at_zero"),
            "low": sum(1 for row in mait_rows if row["state"] == "low"),
            "low_stock_threshold": threshold,
            "locations": len(location_rows),
            "stores": len(shelves),
            "store_straws": sum(shelf["straws_on_hand"] for shelf in shelves),
        },
        "locations": location_rows,
        "maits": mait_rows,
        "stores": [
            {key: value for key, value in shelf.items() if not key.startswith("_")}
            for shelf in shelves
        ],
        "products": products,
    }
