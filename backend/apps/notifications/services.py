"""Notification dispatch.

``notify()`` is the single entry point used by the leave and timesheet
workflows. It writes the in-app row synchronously (so the recipient sees it
immediately) and, once the transaction commits, hands the email to Celery from a
background thread. With no worker Celery sends it there and then, so the thread
is what keeps that away from the request. In tests it all happens inline.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from django.conf import settings
from django.db import connections, transaction

from apps.notifications.models import Notification

logger = logging.getLogger("empportal.notifications")

# Two, so a mail server timing out still lets the rest through, without opening
# a connection per employee when a whole month is released.
_email_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="notification-email")


def notify(
    recipient,
    *,
    title: str,
    message: str = "",
    kind: str = Notification.Kind.GENERAL,
    level: str = Notification.Level.INFO,
    link: str = "",
    send_email: bool = True,
) -> Notification | None:
    """Creates one notification. Returns ``None`` when there is no recipient."""
    if recipient is None:
        return None

    notification = Notification.objects.create(
        recipient=recipient,
        title=title,
        message=message,
        kind=kind,
        level=level,
        link=link,
    )

    if send_email and getattr(recipient, "email", ""):
        if settings.NOTIFICATION_EMAIL_INLINE:
            _send_email(notification.pk)
        else:
            transaction.on_commit(partial(_email_pool.submit, _send_email, notification.pk))
    return notification


def _send_email(notification_id: int) -> None:
    """Hands one email over, on the pool's thread rather than the request's.

    Whoever is sending it - a worker through the broker, or SMTP right here on a
    host with neither - can take far longer than a request may. One approval
    tells several people, and at ten seconds a timeout, retried, that was two
    minutes inside the transaction, holding the row, with the browser long gone.
    """
    from apps.notifications.tasks import send_notification_email

    try:
        send_notification_email.delay(notification_id)
    except Exception:
        logger.warning(
            "Could not send the email for notification %s; the in-app "
            "notification was still created.",
            notification_id,
        )
    finally:
        if not settings.NOTIFICATION_EMAIL_INLINE:
            connections.close_all()  # this thread's own, which nothing else closes


def notify_many(recipients, **kwargs) -> list[Notification]:
    return [n for n in (notify(user, **kwargs) for user in recipients) if n is not None]


def users_holding(code: str):
    """Whoever can do something today - a role, not a person."""
    from django.contrib.auth import get_user_model
    from django.db.models import Q

    from common.enums import RoleSlug

    return (
        get_user_model()
        .objects.filter(is_active=True)
        .filter(
            Q(user_roles__role__permissions__code=code)
            | Q(user_roles__role__slug=RoleSlug.SUPER_ADMIN)
        )
        .distinct()
    )


def frontend_url(path: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/{path.lstrip('/')}"
