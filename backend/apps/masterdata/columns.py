"""
Column mapping for the SAP exports (SRS §6.1.2).

SAP headers do not match the tidy names the SRS describes them by, and they differ between
exports in ways that matter:

* ``MPPName`` has no space; ``Member name`` does.
* Geo columns are ``State Code`` / ``District Code`` / ``Tahsil Code`` — and SAP spells it
  *Tahsil* where this codebase uses *tehsil*.
* Several Member columns carry a trailing period: ``Form no.``, ``Folio no.``, ``Bank A/C No.``
* ``Sahyak.xlsx`` contains **two** columns named ``Mobile No`` — the MPP's at index 12 and
  the Sahayak's at index 20.

So headers are normalised and looked up through an alias table rather than matched literally.
Duplicates are suffixed on their second and later appearances (``mobile no``, ``mobile no__2``)
so both can be addressed instead of one silently overwriting the other.

When a periodic export drifts, this file is the only place that should need to change.
"""

from __future__ import annotations

import re

# --------------------------------------------------------------------------------------
# Header normalisation
# --------------------------------------------------------------------------------------


def normalise(header) -> str:
    """
    Reduce a raw SAP header to a stable lookup key.

    Lowercases, collapses internal whitespace, and strips trailing punctuation, so
    ``"Folio no."``, ``"FOLIO NO"`` and ``"Folio  No."`` all resolve to ``folio no``.
    """
    if header is None:
        return ""
    # Excel exports scatter non-breaking spaces (U+00A0) through header cells.
    text = re.sub(r"[\s\u00a0]+", " ", str(header)).strip().lower()
    return text.rstrip(". :")


def build_header_index(raw_headers) -> list[str]:
    """
    Normalise a header row, suffixing repeats so duplicates stay addressable.

    ``["Mobile No", ..., "Mobile No"]`` becomes ``["mobile no", ..., "mobile no__2"]``.
    Without this, a dict built from the row would keep only the last one — which in
    ``Sahyak.xlsx`` means every MPP silently inherits the Sahayak's phone number.
    """
    seen: dict[str, int] = {}
    result: list[str] = []
    for raw in raw_headers:
        key = normalise(raw)
        if not key:
            result.append("")
            continue
        seen[key] = seen.get(key, 0) + 1
        result.append(key if seen[key] == 1 else f"{key}__{seen[key]}")
    return result


def pick(row: dict, *aliases: str):
    """Return the first alias present in the row with a non-empty value."""
    for alias in aliases:
        value = row.get(alias)
        if value not in (None, "", "None"):
            return value
    return None


# --------------------------------------------------------------------------------------
# Required columns — the file is rejected outright if these are missing (SRS §6.1.2)
# --------------------------------------------------------------------------------------
# Deliberately minimal: only the natural key and the one field that makes a row meaningful.
# Anything stricter rejects a whole 105k-row file over a column nobody reads.

REQUIRED_MEMBER = ("member code", "member name")
REQUIRED_MPP = ("mpp code",)
# A nested tuple means "any one of these will do". The vendor export has shipped under two
# header sets and both name the same column — see the note on VENDOR below.
REQUIRED_VENDOR = (("customer id", "vendor"),)
# Only the MPP is required. A blank Sahayak column is meaningful — it unassigns.
REQUIRED_ASSIGNMENT = ("mpp code",)


# --------------------------------------------------------------------------------------
# Aliases, in priority order. First non-empty match wins.
# --------------------------------------------------------------------------------------

MEMBER = {
    "mpp_code": ("mpp", "mpp code"),
    "member_code": ("member code",),
    "member_name": ("member name",),
    "father_husband_name": ("father/husband name", "father husband name"),
    "gender": ("gender",),
    "age": ("age",),
    "category": ("category",),
    "education": ("education",),
    "social_class": ("class",),
    "sap_vendor_code": ("sap vendor",),
    "form_no": ("form no",),
    "folio_no": ("folio no",),
    "mobile_no": ("mobile no",),
    "aadhar_no": ("aadhar no", "aadhaar no"),
    "cattle_holding": ("cattle holding",),
    "bank_ac_no": ("bank a/c no", "bank ac no", "account number"),
    "bank_name": ("bank name",),
    "bank_branch": ("bank branch",),
    "ifsc_code": ("ifsc code",),
    "activation_status": ("activation status",),
    "activation_date": ("activation date",),
    "deactivation_date": ("deactivation date",),
    "remarks": ("remarks",),
}

# Sahyak.xlsx — carries the MPP record and its linked Sahayak (Mait) in one row.
MPP = {
    "plant_code": ("plant", "plant code"),
    "plant_name": ("plant name",),
    "mpp_code": ("mpp code",),
    "mpp_name": ("mppname", "mpp name"),
    "mpp_category": ("mpp category",),
    "mpp_sub_category": ("mpp sub category",),
    "state_code": ("state code", "state"),
    "district_code": ("district code", "district"),
    # SAP spells it "Tahsil"; this codebase uses "tehsil". Both accepted.
    "tehsil_code": ("tahsil code", "tehsil code", "tahsil", "tehsil"),
    "panchayat_code": ("panchayat code", "panchayat"),
    "village_code": ("village code", "village"),
    "hamlet_code": ("hamlet code", "hamlet"),
    # The FIRST "Mobile No" is the MPP's own contact number.
    "mobile_no": ("mobile no",),
    "address_line": ("address line", "address"),
    "is_active": ("active",),
    "start_date": ("start date",),
    "end_date": ("end date",),
    "revival_date": ("revival date",),
}

# The Sahayak (Mait) fields living in the same Sahyak.xlsx row.
SAHAYAK = {
    "sahayak_vendor_code": ("sahayak vendor",),
    "name": ("sahayak name",),
    # The SECOND "Mobile No" belongs to the Sahayak, not the MPP.
    "mobile_no": ("mobile no__2", "sahayak mobile no"),
    "pan_no": ("pan no", "pan number"),
    "aadhar_no": ("aadhar no", "aadhaar no", "aadhar number"),
    "bank_account_no": ("bank account number", "account number"),
    "ifsc_code": ("ifsc code for joint account", "ifsc code", "bank key"),
}

# Maits Vendor C.xlsx — a separate customer-numbered file. See the note in tasks.py about
# its identifier space not matching the Sahayak vendor codes.
# The vendor export has been seen under two header sets. The older one is customer-flavoured
# ("CUSTOMER ID", "NAME OF THE CUSTOMER"); the SAP EXPORT_* one is vendor-flavoured ("VENDOR",
# "VENDOR NAME", "CONTACT NO") and carries the ZMAI account group. Both are the same list of
# Maits, so both spellings are accepted rather than making an operator rename columns.
VENDOR = {
    "sahayak_vendor_code": ("customer id", "vendor"),
    "name": (
        "name of the customer",
        "vendor name",
        "contact person name",
        "contact person",
        "name",
    ),
    "mobile_no": ("customer contact number", "contact no", "contact number", "mobile no"),
    "pan_no": ("pan number", "pan no"),
    "aadhar_no": ("aadhar number", "aadhar no", "aadhaar number"),
    "gst_no": ("gst number", "gst no"),
    "bank_account_no": ("account number", "bank account"),
    "ifsc_code": ("bank key", "ifsc code"),
}


# ----------------------------------------------------------------------------------------
# Assignment workbook — the round-trip file, not a SAP export.
# ----------------------------------------------------------------------------------------
# Downloaded from the portal already filled with the current mapping, edited, and uploaded
# back. Its headers are ours rather than SAP's, so they are spelled the way the template
# writes them — but the aliases still accept the SAP spellings, because an operator working
# from Sahyak.xlsx will paste those column names in without thinking about it.
# "Mait", not "Sahayak": the MPP master's Sahayak column is the person staffing the collection
# point, which is a different job from covering it. The sahayak spellings stay accepted so a
# sheet downloaded before the rename still uploads, and a row naming a retired Sahayak is
# caught by the handler rather than silently assigned.
ASSIGNMENT = {
    "mpp_code": ("mpp code", "mppcode"),
    "sahayak_vendor_code": (
        "mait vendor",
        "mait vendor code",
        "sahayak vendor",
        "sahayak vendor code",
        "vendor code",
    ),
    "name": ("mait name", "sahayak name", "name"),
    "mobile_no": ("mobile no", "mait mobile no", "sahayak mobile no", "mobile"),
}
