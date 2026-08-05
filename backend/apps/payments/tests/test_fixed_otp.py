"""
Tests for the fixed development OTP.

A known OTP is a complete authentication bypass for anyone who learns the number, so what
matters here is not that it works — it is that it cannot reach production, and that it
weakens nothing else while it is on.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.payments.models import OTPLog
from apps.payments.services import generate_code, issue_otp, verify_otp

pytestmark = pytest.mark.django_db

TEST_NUMBER = "9999999999"
OTHER_NUMBER = "9876543210"


@pytest.fixture
def fixed_otp_enabled(settings):
    """pytest-django's settings fixture — override_settings only decorates TestCase classes."""
    settings.DEV_FIXED_OTP_NUMBERS = [TEST_NUMBER]
    settings.DEV_FIXED_OTP_CODE = "123456"
    return settings


@pytest.mark.usefixtures("fixed_otp_enabled")
class TestFixedOTPEnabled:
    def test_listed_number_gets_the_known_code(self):
        assert generate_code(TEST_NUMBER) == "123456"

    def test_every_other_number_still_gets_a_random_code(self):
        """The bypass must be exactly as wide as the list and no wider."""
        codes = {generate_code(OTHER_NUMBER) for _ in range(50)}
        assert len(codes) > 40, "codes for an unlisted number should not repeat"
        assert "123456" not in codes or len(codes) > 40

    def test_the_known_code_verifies(self):
        issue_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN)
        otp = verify_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN, code="123456")
        assert otp.is_verified is True

    def test_a_wrong_code_is_still_rejected(self):
        """Only the fixed code works — the number is not a free pass."""
        from apps.core.exceptions import OTPInvalid

        issue_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN)
        with pytest.raises(OTPInvalid):
            verify_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN, code="000000")

    def test_expiry_still_applies(self):
        """A known code must not be an immortal one."""
        from apps.core.exceptions import OTPExpired

        issue_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN)
        OTPLog.objects.filter(mobile_no=TEST_NUMBER).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        with pytest.raises(OTPExpired):
            verify_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN, code="123456")

    def test_the_attempt_limit_still_applies(self):
        """The brute-force guard is not relaxed just because the code is predictable."""
        from apps.core.exceptions import OTPAttemptsExceeded, OTPInvalid

        issue_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN)
        for _ in range(3):
            with pytest.raises((OTPInvalid, OTPAttemptsExceeded)):
                verify_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN, code="000000")

        with pytest.raises(OTPAttemptsExceeded):
            verify_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN, code="123456")

    def test_the_issue_is_still_audited(self):
        """An OTP that leaves no trace would be invisible to fraud review."""
        issue_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN)
        assert OTPLog.objects.filter(mobile_no=TEST_NUMBER).exists()

    def test_the_code_is_still_stored_hashed(self):
        issue_otp(mobile_no=TEST_NUMBER, purpose=OTPLog.Purpose.LOGIN)
        otp = OTPLog.objects.get(mobile_no=TEST_NUMBER)
        assert otp.otp_code_hash != "123456"
        assert len(otp.otp_code_hash) == 64


class TestFixedOTPDisabledByDefault:
    def test_empty_list_means_every_code_is_random(self, settings):
        settings.DEV_FIXED_OTP_NUMBERS = []
        codes = {generate_code(TEST_NUMBER) for _ in range(50)}
        assert len(codes) > 40


class TestProductionRefusesToBoot:
    def test_production_settings_raise_when_the_list_is_set(self, monkeypatch):
        """
        The only guard that holds. A warning in a log gets missed, and by the time anyone
        reads it the door has been open for a week.
        """
        import importlib

        # The production settings module imports the production-only dependencies. Skipping
        # is honest when they are absent; asserting nothing would look like a pass.
        pytest.importorskip("sentry_sdk", reason="production settings need sentry-sdk")
        pytest.importorskip("storages", reason="production settings need django-storages")

        monkeypatch.setenv("DEV_FIXED_OTP_NUMBERS", TEST_NUMBER)
        monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "api.example.com")
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "bWFpdGFpLXRlc3Qta2V5LWRvLW5vdC11c2UtcmVhbCE=")
        monkeypatch.setenv("AWS_STORAGE_BUCKET_NAME", "bucket")

        with pytest.raises(RuntimeError, match="DEV_FIXED_OTP_NUMBERS"):
            importlib.reload(importlib.import_module("config.settings.production"))
