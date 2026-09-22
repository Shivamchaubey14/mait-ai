"""
An Indian mobile number, normalised the one way the platform stores it.

Shared by the SAP importer and the office's own edits, so a number typed on the Members screen
and a number read out of a workbook are the same ten digits or nothing — never two spellings
of one phone that a lookup would treat as two phones.
"""

from __future__ import annotations


def normalise_mobile(value) -> str:
    """
    Ten digits starting 6-9, or ``""`` when the value cannot be salvaged.

    SAP exports carry these inconsistently — as floats, with +91, with spaces. Nothing is
    guessed: a wrong number means the payment authorisation OTP goes to a stranger (SRS §6.5).
    """
    # Exactly the importer's rule, moved here unchanged so the SAP upload accepts precisely
    # what it always has. Float cells ("9876543210.0") are the importer's `_clean`'s to undo.
    raw = ("" if value is None else str(value).strip()).replace(" ", "").replace("-", "")
    if raw.startswith("+91"):
        raw = raw[3:]
    elif raw.startswith("91") and len(raw) == 12:
        raw = raw[2:]
    return raw if len(raw) == 10 and raw[0] in "6789" and raw.isdigit() else ""
