"""Logging helpers."""

import logging


class RequestIDFilter(logging.Filter):
    """Make ``request_id`` always available to the formatter, even outside a request."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True
