"""
The smsfortius SMS gateway.

What matters is that the right DLT template is chosen for the step, that the one variable is
filled with the code (and no `{#var#}` placeholder ever goes out), and that a gateway failure
propagates so `dispatch_otp` retries — the office's own code is the fallback when it keeps
failing, so a down gateway never strands a sign-in or a payment.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from apps.payments.models import OTPLog
from apps.payments.services import send_sms

SMS = {
    "PROVIDER": "smsfortius",
    "API_KEY": "test-key",
    "SENDER_ID": "SHWETD",
    "BASE_URL": "https://smsfortius.work/V2/apikey.php",
    "TEMPLATES": {
        "login": {"template_id": "LOGIN-TPL", "text": "Login OTP {#var#}. Tell no one."},
        "verify": {"template_id": "VERIFY-TPL", "text": "Verify OTP {#var#}. Read it to the Mait."},
    },
}


def _ok(text="OK|42"):
    response = MagicMock()
    response.text = text
    response.raise_for_status.return_value = None
    return response


@pytest.fixture(autouse=True)
def _gateway(settings):
    """Point the gateway at smsfortius with stub templates for every test in this module."""
    settings.SMS_GATEWAY = SMS


class TestSmsFortius:
    def test_login_uses_the_login_template_with_the_code_filled_in(self):
        with patch("requests.get", return_value=_ok("OK|42")) as get:
            message_id = send_sms(
                mobile_no="7518914554", code="482913", purpose=OTPLog.Purpose.LOGIN
            )

        params = get.call_args.kwargs["params"]
        assert get.call_args.args[0] == SMS["BASE_URL"]
        assert params["apikey"] == "test-key"
        assert params["senderid"] == "SHWETD"
        assert params["templateid"] == "LOGIN-TPL"
        assert params["number"] == "7518914554"
        assert params["message"] == "Login OTP 482913. Tell no one."
        assert "{#var#}" not in params["message"]
        assert message_id == "OK|42"

    @pytest.mark.parametrize(
        "purpose",
        [
            OTPLog.Purpose.FARMER_VERIFY,
            OTPLog.Purpose.PAYMENT_COD,
            OTPLog.Purpose.PAYMENT_ONLINE,
        ],
    )
    def test_every_farmer_facing_step_uses_the_verify_template(self, purpose):
        with patch("requests.get", return_value=_ok()) as get:
            send_sms(mobile_no="7518914554", code="111222", purpose=purpose)

        params = get.call_args.kwargs["params"]
        assert params["templateid"] == "VERIFY-TPL"
        assert params["message"] == "Verify OTP 111222. Read it to the Mait."

    def test_a_gateway_error_propagates_so_dispatch_retries(self):
        failing = MagicMock()
        failing.raise_for_status.side_effect = requests.HTTPError("502 from gateway")
        with patch("requests.get", return_value=failing):
            with pytest.raises(requests.HTTPError):
                send_sms(mobile_no="7518914554", code="000000", purpose=OTPLog.Purpose.LOGIN)

    def test_a_long_reply_is_truncated_to_the_column_so_it_cannot_500(self):
        # smsfortius answers with a status line well past the message-id column's width. Stored
        # untrimmed it raised a 1406 DataError that rolled the whole OTP back — so the id must
        # come back no longer than the column can hold, whatever the vendor sent.
        column = OTPLog._meta.get_field("gateway_message_id").max_length
        with patch("requests.get", return_value=_ok("SUBMITTED|" + "9" * 300)):
            message_id = send_sms(
                mobile_no="7518914554", code="482913", purpose=OTPLog.Purpose.LOGIN
            )

        assert len(message_id) <= column
