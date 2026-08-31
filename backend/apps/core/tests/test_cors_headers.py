"""
The headers a browser is allowed to send us.

This exists because of a regression that shipped. The portal and the mobile client both send
`ngrok-skip-browser-warning` on every request — it is meaningless to this API and the
difference between working and not when a tunnel sits in front of it. Adding it to the clients
without adding it here made every cross-origin call a preflight the browser then refused.

The failure had no visible cause anywhere: no error in the API logs, nothing in the portal's
own code, just every screen at once reporting that the server could not be reached. Nothing in
the suite noticed, because a same-origin test client never performs a preflight at all — only
a browser does. Hence a test that performs one.
"""

from __future__ import annotations

import pytest
from django.test import Client, override_settings

pytestmark = pytest.mark.django_db

# Any endpoint will do; the preflight never reaches the view.
PROBE = "/api/v1/auth/time/"
PORTAL_ORIGIN = "http://127.0.0.1:8080"


def preflight(headers: str):
    """
    Ask the way a browser asks before it will send a request with custom headers.

    The origin is allowed explicitly rather than left to whichever settings module is loaded.
    What shipped broken was the *header* list, and a test that also depended on the origin
    policy would go quiet under the test settings — which allow no origins — and report
    nothing about the thing it exists to check.
    """
    with override_settings(CORS_ALLOW_ALL_ORIGINS=True):
        return Client().options(
            PROBE,
            HTTP_ORIGIN=PORTAL_ORIGIN,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS=headers,
        )


def allowed(response) -> set[str]:
    raw = response.headers.get("access-control-allow-headers", "")
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


class TestThePreflight:
    def test_the_tunnel_header_is_allowed(self):
        """
        The one this test exists for.

        Both clients send it unconditionally, so if it is not on this list every request they
        make from another origin is blocked before it leaves the browser.
        """
        assert "ngrok-skip-browser-warning" in allowed(
            preflight("authorization,ngrok-skip-browser-warning")
        )

    def test_the_headers_the_clients_actually_send_are_all_allowed(self):
        """
        Every custom header either client sends, checked together.

        A browser refuses the whole request if *any* requested header is missing from the
        list, so checking them one at a time would pass while the real combination failed.
        """
        sending = {
            "authorization",  # every authenticated call
            "content-type",  # every POST and PATCH
            "ngrok-skip-browser-warning",
            "x-requested-with",  # jQuery sets it on every ajax call
        }

        assert sending <= allowed(preflight(",".join(sorted(sending))))

    def test_the_apps_idempotency_key_is_not_the_same_question(self):
        """
        `Idempotency-Key` is deliberately absent, and that is not an oversight.

        Only the handset sends it (ADR 0003), and React Native is not a browser: it performs
        no preflight and this list has no bearing on it. Allowing it here would be config
        added on speculation. This test exists so that if a browser client ever does need it,
        it fails here — with the reason written down — rather than as another silent outage.
        """
        assert "idempotency-key" not in allowed(preflight("idempotency-key"))

    def test_the_defaults_are_kept(self):
        """
        Added to the default list, not substituted for it.

        Writing this setting as a bare tuple drops `content-type`, and with it every POST the
        portal makes — a wider outage than the one being fixed.
        """
        assert {"accept", "authorization", "content-type"} <= allowed(preflight("authorization"))
