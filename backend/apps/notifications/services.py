"""Notification dispatch.

``notify()`` is the single entry point used by the leave and timesheet
workflows. It writes the in-app row synchronously (so the recipient sees it
immediately) and hands the email to Celery. With ``CELERY_TASK_ALWAYS_EAGER``
in tests, and the console email backend locally, this stays side-effect free.
"""

import logging

from django.conf import settings

from apps.notifications.models import Notification

logger = logging.getLogger("empportal.notifications")


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
        from apps.notifications.tasks import send_notification_email

        try:
            send_notification_email.delay(notification.pk)
        except Exception:  # pragma: no cover - broker unavailable locally
            logger.warning(
                "Could not queue the notification email for %s; the in-app "
                "notification was still created.",
                recipient.email,
            )
    return notification


def notify_many(recipients, **kwargs) -> list[Notification]:
    return [n for n in (notify(user, **kwargs) for user in recipients) if n is not None]


def frontend_url(path: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/{path.lstrip('/')}"
