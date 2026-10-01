"""Logging helpers - correlates every log line with its request."""

import logging

from common.request_context import get_request_id


class RequestIDFilter(logging.Filter):
    """Injects ``request_id`` into every record so log lines are traceable."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()
        return True
