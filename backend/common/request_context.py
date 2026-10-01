"""Per-request context, available to logging and audit code without plumbing.

Populated by :class:`common.middleware.RequestIDMiddleware` and read by the
logging filter and (from Phase 1 onwards) the audit-log service.
"""

from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("request_id", default="-")
_user_id: ContextVar[str] = ContextVar("user_id", default="-")
_client_ip: ContextVar[str] = ContextVar("client_ip", default="-")


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str:
    return _request_id.get()


def set_user_id(value: str) -> None:
    _user_id.set(value)


def get_user_id() -> str:
    return _user_id.get()


def set_client_ip(value: str) -> None:
    _client_ip.set(value)


def get_client_ip() -> str:
    return _client_ip.get()
