"""
Idempotency support for retryable writes (SRS §9.11, ADR 0003).

The mobile app queues AI events offline and drains the queue on reconnect, often over a
connection that drops mid-flight. It cannot tell "the server never received this" from
"the server processed it and the response was lost", so it retries blindly. This module is
what makes that safe.

A record is identified by **key and endpoint together**, never by the key alone. ADR 0003 makes
the capture's ``client_uuid`` the ``Idempotency-Key`` on *every* write for that event, so one
key legitimately arrives at several endpoints with a different body each time. Keyed globally,
the create's stored record answered the completion's lookup, the fingerprints disagreed, and
every completion in the product was rejected as a client bug — on a perfect network.

Usage::

    @idempotent(endpoint="ai-events.complete")
    def post(self, request, *args, **kwargs):
        ...
"""

from __future__ import annotations

import functools
import hashlib
import json
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.response import Response

from .exceptions import IdempotencyKeyConflict
from .models import IdempotencyRecord

HEADER = "HTTP_IDEMPOTENCY_KEY"


def fingerprint(payload) -> str:
    """Stable hash of a request body, insensitive to key ordering."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def idempotent(endpoint: str):
    """
    Replay the stored response when a request repeats a known Idempotency-Key.

    Requests without the header pass straight through — the key is optional, so a caller
    that does not need retry safety is not forced to generate one.
    """

    def decorator(view_method):
        @functools.wraps(view_method)
        def wrapper(self, request, *args, **kwargs):
            key = request.META.get(HEADER)
            if not key:
                return view_method(self, request, *args, **kwargs)

            fp = fingerprint(getattr(request, "data", {}))
            # Scoped to this endpoint. The same key is expected at several of them for one
            # capture (ADR 0003); it is a reuse *within* one endpoint that means a client bug.
            existing = IdempotencyRecord.objects.filter(
                key=key, endpoint=endpoint, expires_at__gt=timezone.now()
            ).first()

            if existing:
                if existing.request_fingerprint != fp:
                    # Same key, same endpoint, different body. Replaying the stored response
                    # here would silently return the wrong answer and hide a real client bug.
                    raise IdempotencyKeyConflict()
                return Response(existing.response_body, status=existing.response_status)

            response = view_method(self, request, *args, **kwargs)

            # Only successful writes are recorded. A failure should be genuinely retryable,
            # not permanently pinned to its first error.
            if 200 <= response.status_code < 300:
                # `render()` is required because DRF populates `.data` lazily.
                body = response.data if hasattr(response, "data") else {}
                try:
                    with transaction.atomic():
                        IdempotencyRecord.objects.create(
                            key=key,
                            endpoint=endpoint,
                            request_fingerprint=fp,
                            response_status=response.status_code,
                            response_body=body,
                            expires_at=timezone.now()
                            + timedelta(hours=settings.IDEMPOTENCY_TTL_HOURS),
                        )
                except IntegrityError:
                    # Two concurrent retries of the same key raced to insert. The other
                    # one won and stored an equivalent response; nothing to reconcile.
                    pass

            return response

        return wrapper

    return decorator
