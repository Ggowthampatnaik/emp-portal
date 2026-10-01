"""Background work for sign-in flows."""

from datetime import timedelta

from celery import shared_task

from apps.authentication import reset


@shared_task
def send_temporary_password(user_id: int, ip: str = "") -> str:
    """Generates a temporary password for the account and emails it.

    Deliberately given the user's id and nothing else: the worker mints the
    credential itself, so no secret ever sits in the broker. No automatic
    retry - a send that fails rolls its token back, and the person asks again,
    which is the same thing a retry would do without the risk of two live
    temporary passwords racing each other.
    """
    return "sent" if reset.issue_and_deliver(user_id, ip) else "not sent"


@shared_task
def flush_expired_tokens() -> str:
    """Drops blacklisted refresh tokens whose lifetime has run out anyway.

    Every refresh writes two rows now that rotation blacklists its predecessor,
    so without this the tables grow for as long as the portal is used - and the
    blacklist is consulted on every refresh, so they get slower as they grow.
    """
    from django.core.management import call_command

    call_command("flushexpiredtokens", verbosity=0)
    return "flushed"


@shared_task
def purge_reset_tokens(days: int = 30) -> int:
    """Removes spent password-reset tokens once they are long past useful.

    They hold a hash of a credential and are read on failed sign-ins; neither
    is a reason to keep them for the life of the deployment.
    """
    from django.utils import timezone

    from apps.authentication.models import PasswordResetToken

    cutoff = timezone.now() - timedelta(days=days)
    removed, _ = PasswordResetToken.objects.filter(created_at__lt=cutoff).delete()
    return removed
