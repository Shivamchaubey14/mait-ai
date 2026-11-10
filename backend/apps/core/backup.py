"""
The whole application database, as a ZIP a Super Admin can take off the server (W-backup).

The audit export beside this one hands over *one table*, filtered, for an auditor. This hands
over *everything* — every row of every table the application owns — so the office holds a cold
copy of the live system it can keep, move, or restore from the day a disk dies or a migration
goes wrong.

**Why a ZIP of `dumpdata` rather than a raw SQL dump.** A `mysqldump` is tied to MySQL, to the
exact server version, and to a shell on the box; this endpoint has none of those and must not
grow them. Django's own serialization is database-agnostic and restores with a single
``manage.py loaddata`` onto any backend with the migrations applied — which is exactly what a
restore is. The round-trip is the one Django supports and tests, so the backup is restorable by
definition rather than by hope.

**One combined data file, not one per table.** ``loaddata`` disables foreign-key checks for the
duration of the load and verifies them once at the end, so the order rows sit in the file does
not matter — but *splitting* them across files that are then loaded separately would matter,
because a members file loaded before the MPPs it points at would fail on a half-loaded restore.
So the rows are one file, and the manifest beside it is what makes the archive legible.

**Super Admin alone.** Every other export here is gated by a portal section; this one is not,
because it is not a section — it is the keys to the whole building. ``IsSuperAdmin`` is the
same gate that guards nothing-else-comes-close actions, and it is the right height for a file
that carries every farmer's Aadhaar, every Mait's bank account, and every password hash in the
system.

**Taking it is recorded before it is built**, exactly as the audit export is and for the same
reason: a backup that only logs the downloads which finished is a log with a gap precisely
where an insider taking a copy off-site would want one.
"""

from __future__ import annotations

import io
import json
import tempfile
import zipfile
from pathlib import Path

from django.apps import apps as django_apps
from django.core.management import call_command
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view, permission_classes

from apps.core.models import AuditLog
from apps.core.permissions import IsSuperAdmin
from apps.core.services import record_audit

#: Only the application's own tables. Django's machinery — content types, the permission rows,
#: sessions, admin log — is rebuilt by ``migrate`` on the target and would only collide on a
#: restore, so it is left out. What stays is every table the product defined for itself.
APP_PREFIX = "apps."


def _project_app_labels() -> list[str]:
    """The app labels the product owns, in a stable order."""
    return sorted(
        config.label
        for config in django_apps.get_app_configs()
        if config.name.startswith(APP_PREFIX)
    )


def _model_counts(app_labels: list[str]) -> list[dict]:
    """A row-count per table, for the manifest — what the file claims to contain."""
    counts: list[dict] = []
    for label in app_labels:
        config = django_apps.get_app_config(label)
        for model in config.get_models():
            counts.append(
                {
                    "app": label,
                    "model": model._meta.object_name,
                    "table": model._meta.db_table,
                    "rows": model.objects.count(),
                }
            )
    return counts


def _dump_to(path: Path, app_labels: list[str]) -> None:
    """
    Serialize every row of every app table to ``path`` as one JSON document.

    Written to a file on disk rather than held in a string: a full copy of the live database
    is the one export here with no natural ceiling, and the office that most needs a backup is
    the one whose database has grown large enough to make one worth taking.
    """
    with path.open("w", encoding="utf-8") as handle:
        call_command(
            "dumpdata",
            *app_labels,
            format="json",
            indent=2,
            # The default. Natural keys would need every model to define them, which they do
            # not, and a mixed file is worse than a plain one — loaddata restores pk-keyed rows
            # without any help.
            use_natural_foreign_keys=False,
            use_natural_primary_keys=False,
            stdout=handle,
        )


@extend_schema(
    tags=["core"],
    summary="Download the whole database as a backup ZIP",
    description=(
        "A cold copy of the entire application database, as a ZIP a Super Admin can keep or "
        "restore from. Inside: `data/maitai-data.json` — every row of every application table, "
        "in Django's own serialization — plus `manifest.json` (when it was taken, by whom, and "
        "a row count per table) and `RESTORE.txt`.\n\n"
        "Restore onto any database with the migrations applied:\n"
        "`python manage.py loaddata data/maitai-data.json`\n\n"
        "**Super Admin only, and the taking of it is itself recorded** in the audit trail "
        "before the file is built — this archive carries every farmer's Aadhaar, every Mait's "
        "bank details, and every password hash in the system."
    ),
    responses={200: bytes},
)
@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def database_backup(request):
    """Record that the backup was taken, then build and return it."""
    app_labels = _project_app_labels()
    counts = _model_counts(app_labels)
    total_rows = sum(item["rows"] for item in counts)

    taken_at = timezone.localtime()
    actor = request.user
    actor_name = (getattr(actor, "full_name", "") or actor.username) if actor else "Unknown"

    # Before the file, deliberately: a backup that fell over halfway still means a Super Admin
    # asked the server to hand the whole database over, and a log that records only the copies
    # that completed is a log with a gap exactly where someone taking one off-site would want it.
    entry = record_audit(
        action=AuditLog.Action.PII_ACCESS,
        entity_type="backup",
        entity_id="full_database",
        request=request,
        meta={"tables": len(counts), "rows": total_rows},
    )

    manifest = {
        "product": "Mait AI",
        "kind": "full-database-backup",
        "taken_at": taken_at.isoformat(),
        "taken_by": {
            "name": actor_name,
            "username": getattr(actor, "username", ""),
            "role": getattr(actor, "role", ""),
        },
        "recorded_in_trail_as": entry.request_id or "",
        "total_tables": len(counts),
        "total_rows": total_rows,
        "tables": counts,
        "format": "django-dumpdata-json",
        "restore": "python manage.py loaddata data/maitai-data.json",
        "contains_personal_data": True,
    }

    restore_text = (
        "Mait AI — full database backup\n"
        f"Taken: {taken_at.strftime('%d %b %Y, %H:%M:%S %Z')}\n"
        f"By:    {actor_name} ({getattr(actor, 'username', '')})\n"
        f"Rows:  {total_rows:,} across {len(counts)} tables\n\n"
        "TO RESTORE\n"
        "  1. Stand up a database and apply the schema:  python manage.py migrate\n"
        "  2. Load the data:                             python manage.py loaddata "
        "data/maitai-data.json\n\n"
        "Restore onto an EMPTY, freshly-migrated database. loaddata inserts rows by primary "
        "key; loading over a database that already holds data will collide on those keys.\n\n"
        "CONTAINS PERSONAL DATA — Aadhaar and bank details (decrypted in this file), mobile "
        "numbers, and password hashes. Store it encrypted and treat losing it as a breach.\n"
    )

    # The data file is written to disk first, then folded into the archive, so the process never
    # holds the whole database as a JSON string and the finished ZIP at the same time.
    with tempfile.TemporaryDirectory() as tmp:
        data_path = Path(tmp) / "maitai-data.json"
        _dump_to(data_path, app_labels)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
            archive.writestr("RESTORE.txt", restore_text)
            archive.write(data_path, arcname="data/maitai-data.json")

    stamp = taken_at.strftime("%Y%m%d-%H%M%S")
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="maitai-backup-{stamp}.zip"'
    return response
