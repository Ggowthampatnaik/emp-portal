"""Audit-trail helper.

One call site shape for every module::

    record_audit(request, AuditAction.APPROVE, leave_request,
                 changes={"status": ["pending", "approved"]})

Never raises: a failure to write the trail must not fail the business action,
but it is logged at error level so it cannot pass unnoticed.
"""

import logging
from typing import Any

from django.db import models

from common.request_context import get_client_ip, get_request_id

logger = logging.getLogger("empportal.audit")


def _label(instance: Any) -> str:
    try:
        return str(instance)[:255]
    except Exception:  # pragma: no cover - defensive
        return ""


def record_audit(
    request: Any,
    action: str,
    instance: models.Model | None = None,
    *,
    changes: dict | None = None,
    actor: Any = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
) -> None:
    """Appends one row to ``audit_logs``."""
    from apps.administration.models import AuditLog

    try:
        actor = actor or getattr(request, "user", None)
        if actor is not None and not getattr(actor, "is_authenticated", False):
            actor = None

        if instance is not None:
            entity_type = entity_type or instance.__class__.__name__
            entity_id = entity_id if entity_id is not None else instance.pk

        AuditLog.objects.create(
            actor=actor,
            actor_email=getattr(actor, "email", "") or "",
            action=action,
            entity_type=entity_type or "",
            entity_id=str(entity_id) if entity_id is not None else "",
            entity_label=_label(instance) if instance is not None else "",
            changes=changes or {},
            ip_address=_ip(request),
            request_id=getattr(request, "request_id", None) or get_request_id(),
        )
    except Exception:  # pragma: no cover - never break the business action
        logger.exception("Failed to write audit log for action=%s", action)


def _ip(request: Any) -> str | None:
    """The caller's address, as the middleware worked it out.

    Never read from ``X-Forwarded-For`` here. That header is written by whoever
    sends the request; taking its first entry let anyone stamp an address of
    their choosing on every row of the audit trail. The middleware already
    decides which entries came from a proxy we trust - see
    ``common/middleware.py`` and ``TRUSTED_PROXY_HOPS`` - and puts the answer
    where this can read it.
    """
    ip = get_client_ip()
    if ip and ip != "-":
        return ip
    if request is not None:
        return getattr(request, "META", {}).get("REMOTE_ADDR") or None
    return None


def diff(before: dict, after: dict) -> dict[str, list]:
    """Field-level ``{field: [old, new]}`` for the changed keys only."""
    return {
        key: [before.get(key), after.get(key)]
        for key in set(before) | set(after)
        if before.get(key) != after.get(key)
    }
