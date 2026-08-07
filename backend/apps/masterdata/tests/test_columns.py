"""
Tests for SAP header normalisation (SRS §6.1.2).

Every case here is taken from a real export. They exist because each one silently produced
either a rejected file or wrong data before it was handled — see docs/DATA_FINDINGS.md.
"""

from __future__ import annotations

import pytest

from apps.masterdata import columns as cols
from apps.masterdata.tasks import _missing_columns


class TestNormalise:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("MPP Code", "mpp code"),
            ("MPPName", "mppname"),  # Sahyak.xlsx has no space here
            ("Form no.", "form no"),  # Member.xlsx trailing period
            ("Folio no.", "folio no"),
            ("Bank A/C No.", "bank a/c no"),
            ("CUSTOMER ID", "customer id"),  # vendor file is fully uppercase
            ("  Member  name  ", "member name"),
            ("Tahsil Code", "tahsil code"),  # SAP spells it Tahsil, not Tehsil
            ("", ""),
            (None, ""),
        ],
    )
    def test_normalises_real_headers(self, raw, expected):
        assert cols.normalise(raw) == expected

    def test_strips_non_breaking_spaces(self):
        """
        Excel scatters U+00A0 through header cells; it must not defeat the lookup.

        Built from an escape rather than a literal so the character is visible in the
        source instead of being an invisible byte nobody notices when editing this file.
        """
        nbsp = "\u00a0"
        assert cols.normalise(f"Member{nbsp}name") == "member name"
        assert cols.normalise(f"{nbsp}MPP Code{nbsp}") == "mpp code"


class TestDuplicateHeaders:
    def test_duplicates_are_suffixed_not_collapsed(self):
        """
        Sahyak.xlsx has two columns called "Mobile No" — the MPP's and the Sahayak's.

        A plain dict would keep only the second, so every MPP would silently inherit the
        Sahayak's number. Both must stay addressable.
        """
        headers = cols.build_header_index(
            ["MPP Code", "Mobile No", "Address line", "Sahayak Vendor", "Mobile No"]
        )
        assert headers == [
            "mpp code",
            "mobile no",
            "address line",
            "sahayak vendor",
            "mobile no__2",
        ]

    def test_both_mobile_numbers_survive_the_row_mapping(self):
        headers = cols.build_header_index(["MPP Code", "Mobile No", "Sahayak Vendor", "Mobile No"])
        row = dict(zip(headers, ["001303", "9795402473", "5500000003", "9876543210"], strict=True))

        assert cols.pick(row, *cols.MPP["mobile_no"]) == "9795402473"
        assert cols.pick(row, *cols.SAHAYAK["mobile_no"]) == "9876543210"

    def test_blank_headers_do_not_collide(self):
        """Trailing empty columns are common; they must not all normalise to one key."""
        headers = cols.build_header_index(["MPP Code", None, "", None])
        assert headers == ["mpp code", "", "", ""]


class TestPick:
    def test_returns_first_non_empty_alias(self):
        row = {"mpp": "", "mpp code": "001303"}
        assert cols.pick(row, "mpp", "mpp code") == "001303"

    def test_skips_the_string_none(self):
        """openpyxl and str() coercion both produce the literal 'None' in these exports."""
        row = {"pan no": "None", "pan number": "ABCDE1234F"}
        assert cols.pick(row, "pan no", "pan number") == "ABCDE1234F"

    def test_returns_none_when_nothing_matches(self):
        assert cols.pick({"a": "1"}, "b", "c") is None


class TestAliasCoverage:
    """The alias tables must actually cover the headers in the real files."""

    SAHYAK = [
        "Plant",
        "Plant Name",
        "MPP Code",
        "MPPName",
        "MPP category",
        "MPP Sub category",
        "State Code",
        "District Code",
        "Tahsil Code",
        "Panchayat Code",
        "Village Code",
        "Hamlet code",
        "Mobile No",
        "Address line",
        "Active",
        "Start Date",
        "End Date",
        "Revival date",
        "Sahayak Vendor",
        "Sahayak Name",
        "Mobile No",
        "Pan No",
        "Aadhar No",
        "Bank account number",
        "ifsc code for joint Account",
    ]
    MEMBER = [
        "BMC/MCC",
        "MCC name",
        "MPP",
        "MPP Name",
        "District",
        "District Name",
        "Tehsil",
        "Tehsil Name",
        "Village",
        "Village Name",
        "Pin",
        "Member status",
        "Member code",
        "Member name",
        "Father/Husband Name",
        "Gender",
        "AGE",
        "Category",
        "Education",
        "Class",
        "SAP Vendor",
        "Form no.",
        "Folio no.",
        "Mobile No",
        "Aadhar No",
        "Nominee Name",
        "Relation with Nominee",
        "Guardian",
        "Nominee AGE",
        "Cattle Holding",
        "Bank A/C No.",
        "Bank Name",
        "Bank Branch",
        "IFSC Code",
        "Activation date",
        "Deactivation date",
        "Activation status",
        "Remarks",
    ]
    VENDOR = [
        "CUSTOMER ID",
        "NAME OF THE CUSTOMER",
        "CUSTOMER ADDRESS",
        "ACCOUNT GROUP",
        "CONTACT PERSON NAME",
        "CUSTOMER CONTACT NUMBER",
        "PAN NUMBER",
        "AADHAR NUMBER",
        "GST NUMBER",
        "BANK KEY",
        "ACCOUNT NUMBER",
    ]
    # The same list of Maits under SAP's vendor-flavoured headers (EXPORT_*.xlsx, ZMAI
    # account group). Its PAN column carries no header at all, which is why the importer
    # leaves absent fields alone rather than writing a blank over one.
    VENDOR_EXPORT = [
        "VENDOR",
        "VENDOR NAME",
        "ACCOUNT GROUP",
        "SEARCH TERM 1",
        "ADDRESS",
        "CITY",
        "CONTACT PERSON",
        "CONTACT NO",
        "EMAIL",
        "BANK KEY",
        "BANK ACCOUNT",
        "ACCOUNT HOLDER",
        "",
        "GST NUMBER",
    ]

    @pytest.mark.parametrize(
        ("headers", "table", "required"),
        [
            (SAHYAK, cols.MPP, cols.REQUIRED_MPP),
            (SAHYAK, cols.SAHAYAK, ()),
            (MEMBER, cols.MEMBER, cols.REQUIRED_MEMBER),
            (VENDOR, cols.VENDOR, cols.REQUIRED_VENDOR),
        ],
    )
    def test_every_mapped_field_resolves(self, headers, table, required):
        index = cols.build_header_index(headers)

        # Asked the way the importer asks it: a nested entry means any one of those spellings
        # will do, so the test cannot drift from what actually gates a file.
        assert not _missing_columns(required, index)

        unresolved = [
            field for field, aliases in table.items() if not any(a in set(index) for a in aliases)
        ]
        assert not unresolved, f"no alias matched a real header for: {unresolved}"

    def test_the_vendor_export_headers_are_accepted(self):
        """The EXPORT_* spelling of the same file must not be rejected at the door."""
        index = cols.build_header_index(self.VENDOR_EXPORT)

        assert not _missing_columns(cols.REQUIRED_VENDOR, index)
        for field in ("sahayak_vendor_code", "name", "mobile_no", "bank_account_no"):
            assert any(alias in set(index) for alias in cols.VENDOR[field]), field

    def test_a_file_missing_the_key_is_still_rejected(self):
        index = cols.build_header_index(["VENDOR NAME", "CONTACT NO"])

        # Either spelling satisfies it; neither present must still fail.
        assert _missing_columns(cols.REQUIRED_VENDOR, index) == ["customer id or vendor"]
