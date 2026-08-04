"""
RFC 7807 problem-details error responses (SRS §9.11).

Every error the API emits has the same shape, so clients parse one format:

    {
      "type":   "https://api.maitai.in/errors/insufficient-stock",
      "title":  "Insufficient stock",
      "status": 409,
      "detail": "Straw 3391027744 is not in your current stock.",
      "errors": {"straw_unique_no": ["not_in_stock"]}
    }
"""

from __future__ import annotations

import logging

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)

ERROR_BASE_URI = "https://api.maitai.in/errors"


class DomainError(APIException):
    """Base for business-rule violations. Carries a stable machine-readable code."""

    status_code = status.HTTP_400_BAD_REQUEST
    error_code = "domain-error"
    default_detail = "The request could not be completed."


class InsufficientStock(DomainError):
    """The Mait does not hold the straw they are trying to consume (SRS §6.4.2)."""

    status_code = status.HTTP_409_CONFLICT
    error_code = "insufficient-stock"
    default_detail = "This straw is not in your current stock. Raise a new indent."


class StrawAlreadyConsumed(DomainError):
    status_code = status.HTTP_409_CONFLICT
    error_code = "straw-already-consumed"
    default_detail = "This straw has already been used for another AI event."


class InvalidStateTransition(DomainError):
    """A client asked for a transition the state machine does not allow (SRS §11)."""

    status_code = status.HTTP_409_CONFLICT
    error_code = "invalid-state-transition"
    default_detail = "This action is not allowed from the event's current state."


class PaymentNotVerified(DomainError):
    """Completion attempted while payment is pending or failed (SRS §6.5.3)."""

    status_code = status.HTTP_409_CONFLICT
    error_code = "payment-not-verified"
    default_detail = "The AI event cannot be completed until payment is verified."


class OTPInvalid(DomainError):
    error_code = "otp-invalid"
    default_detail = "The OTP entered is incorrect."


class OTPExpired(DomainError):
    error_code = "otp-expired"
    default_detail = "This OTP has expired. Request a new one."


class OTPAttemptsExceeded(DomainError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    error_code = "otp-attempts-exceeded"
    default_detail = "Too many incorrect attempts. Request a new OTP."


class IdempotencyKeyConflict(DomainError):
    """Same key, different payload — a client bug worth surfacing rather than papering over."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    error_code = "idempotency-key-conflict"
    default_detail = "This Idempotency-Key was already used with a different request body."


class MPPNotAssigned(DomainError):
    """Guards against cross-Mait tampering (SRS §16)."""

    status_code = status.HTTP_403_FORBIDDEN
    error_code = "mpp-not-assigned"
    default_detail = "You are not assigned to this MPP."


def problem_details_handler(exc, context):
    """DRF exception handler that reshapes every error into problem details."""
    response = drf_exception_handler(exc, context)
    if response is None:
        # Unhandled exception: let Django's 500 path own it, but make sure it is recorded
        # with enough context to trace. Never leak the traceback to the client.
        logger.exception("Unhandled exception in %s", context.get("view"))
        return None

    error_code = getattr(exc, "error_code", None) or _code_from_status(response.status_code)
    title = _title_from_status(response.status_code)

    detail = response.data
    field_errors: dict = {}
    if isinstance(detail, dict):
        if "detail" in detail and len(detail) == 1:
            detail = str(detail["detail"])
        else:
            field_errors = {k: _as_list(v) for k, v in detail.items()}
            detail = title
    elif isinstance(detail, list):
        field_errors = {"non_field_errors": _as_list(detail)}
        detail = title

    body = {
        "type": f"{ERROR_BASE_URI}/{error_code}",
        "title": title,
        "status": response.status_code,
        "detail": detail if isinstance(detail, str) else str(detail),
    }
    if field_errors:
        body["errors"] = field_errors

    request = context.get("request")
    request_id = getattr(request, "request_id", None) if request else None
    if request_id:
        body["request_id"] = request_id

    response.data = body
    response["Content-Type"] = "application/problem+json"
    return response


def _as_list(value) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return [str(value)]


def _code_from_status(code: int) -> str:
    return {
        400: "validation-error",
        401: "authentication-required",
        403: "permission-denied",
        404: "not-found",
        405: "method-not-allowed",
        409: "conflict",
        422: "unprocessable-entity",
        429: "rate-limited",
    }.get(code, "error")


def _title_from_status(code: int) -> str:
    return {
        400: "Validation failed",
        401: "Authentication required",
        403: "Permission denied",
        404: "Not found",
        405: "Method not allowed",
        409: "Conflict",
        422: "Unprocessable entity",
        429: "Too many requests",
        500: "Internal server error",
    }.get(code, "Error")
