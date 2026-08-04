"""
HTTP client for Indent Easy (SRS §6.6, §17.1).

Indent Easy is an existing application this platform integrates with rather than replaces.
The API surface it exposes is still an open item for business confirmation (SRS §18.2 item
4); if it turns out no API can be exposed, only this module and
``apps.integrations.services`` change — the fallback is a scheduled file bridge, and nothing
in the domain layer depends on the transport.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class IndentEasyError(Exception):
    """Any failure talking to Indent Easy. Callers retry with backoff."""


class IndentEasyClient:
    """Thin, typed wrapper. Retries and scheduling belong to the Celery task, not here."""

    def __init__(self) -> None:
        cfg = settings.INDENT_EASY
        self.base_url = cfg["BASE_URL"].rstrip("/")
        self.api_key = cfg["API_KEY"]
        self.timeout = cfg["TIMEOUT_SECONDS"]
        if not self.base_url or not self.api_key:
            raise IndentEasyError("Indent Easy integration is not configured.")

    # -- outbound -----------------------------------------------------------------------

    def create_indent(self, indent) -> str:
        """
        Register a Mait's stock request in Indent Easy, returning its reference number.

        That reference is what later deduplicates GRN callbacks, so it is stored on the
        indent immediately.
        """
        payload = {
            "external_ref": f"MAITAI-IND-{indent.id}",
            "vendor_code": indent.mait.sahayak_vendor_code,
            "product_type": indent.product_type,
            "breed": indent.breed,
            "quantity": indent.qty_requested,
            "requested_at": indent.requested_at.isoformat(),
            "note": indent.note,
        }
        data = self._post("/api/indents", payload)
        ref = data.get("indent_ref_no") or data.get("ref_no")
        if not ref:
            raise IndentEasyError(
                f"Indent Easy accepted the request but returned no reference: {data}"
            )
        return str(ref)

    def fetch_grn(self, indent_ref_no: str) -> dict[str, Any] | None:
        """
        Fetch the GRN for an indent, or None if goods have not been issued yet.

        Used by the reconciliation job to catch deliveries whose webhook was lost.
        """
        data = self._get(f"/api/indents/{indent_ref_no}/grn")
        if not data or not data.get("issued"):
            return None
        return data

    # -- inbound ------------------------------------------------------------------------

    @staticmethod
    def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
        """
        Verify the HMAC on an inbound webhook (SRS §16).

        The callback credits stock, so an unauthenticated endpoint here would let anyone
        mint straws. Compared in constant time to avoid leaking the expected digest.
        """
        secret = settings.INDENT_EASY.get("WEBHOOK_SECRET", "")
        if not secret or not signature:
            return False
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    # -- transport ----------------------------------------------------------------------

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _post(self, path: str, payload: dict) -> dict:
        try:
            response = requests.post(
                f"{self.base_url}{path}",
                json=payload,
                headers=self._headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            raise IndentEasyError(f"POST {path} failed: {exc}") from exc
        except ValueError as exc:
            raise IndentEasyError(f"POST {path} returned a non-JSON body") from exc

    def _get(self, path: str) -> dict:
        try:
            response = requests.get(
                f"{self.base_url}{path}", headers=self._headers, timeout=self.timeout
            )
            if response.status_code == 404:
                return {}
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            raise IndentEasyError(f"GET {path} failed: {exc}") from exc
        except ValueError as exc:
            raise IndentEasyError(f"GET {path} returned a non-JSON body") from exc

    def health(self) -> dict[str, Any]:
        """Backs `GET /integrations/indent-easy/status/` (SRS §9.8)."""
        try:
            self._get("/api/health")
            return {"reachable": True, "base_url": self.base_url}
        except IndentEasyError as exc:
            return {"reachable": False, "base_url": self.base_url, "error": str(exc)}
