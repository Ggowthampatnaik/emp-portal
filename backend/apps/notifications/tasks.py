"""Celery tasks for notification delivery."""

import logging

from celery import shared_task
from django.core.mail import send_mail
from django.utils import timezone

from apps.notifications.models import Notification
from apps.notifications.services import frontend_url

logger = logging.getLogger("empportal.notifications")


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification_email(self, notification_id: int) -> str:
    """Emails one notification. Retries transient SMTP failures."""
    notification = (
        Notification.objects.filter(pk=notification_id).select_related("recipient").first()
    )
    if notification is None:
        return "notification missing"
    if notification.emailed_at is not None:
        return "already sent"

    recipient = notification.recipient
    body_lines = [
        f"Hello {recipient.get_short_name()},",
        "",
        notification.message or notification.title,
    ]
    if notification.link:
        body_lines += ["", f"Open the portal: {frontend_url(notification.link)}"]
    body_lines += ["", "--", "Trigyan Employee Portal", "Empowering Ideas"]

    try:
        send_mail(
            subject=f"[Employee Portal] {notification.title}",
            message="\n".join(body_lines),
            from_email=None,  # DEFAULT_FROM_EMAIL
            recipient_list=[recipient.email],
            fail_silently=False,
        )
    except Exception as exc:  # pragma: no cover - depends on SMTP
        logger.warning("Notification email failed for %s: %s", recipient.email, exc)
        if self.request.is_eager:
            return "failed"
        raise self.retry(exc=exc) from exc

    notification.emailed_at = timezone.now()
    notification.save(update_fields=["emailed_at", "updated_at"])
    return "sent"


@shared_task
def purge_old_notifications(days: int = 90) -> int:
    """Housekeeping: drop read notifications older than ``days``."""
    cutoff = timezone.now() - timezone.timedelta(days=days)
    deleted, _ = Notification.objects.filter(is_read=True, created_at__lt=cutoff).delete()
    return deleted
