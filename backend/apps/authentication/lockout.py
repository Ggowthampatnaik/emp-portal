"""Brute-force lockout for password sign-in.

The login endpoint is throttled at 10 requests a minute, but a throttle counts
requests from one address. It does nothing about a patient attacker spread
across a botnet, working one password every few minutes against a single
account - which is what credential stuffing actually looks like. This counts
failures against the *account* instead, so the guess rate is capped no matter
where the guesses come from.

Two deliberate choices:

**The lock is announced.** Saying "locked" tells an attacker the address exists,
which the forgotten-password endpoint carefully avoids. It is worth it here: by
the time this message appears they have already spent the failures that prove
it, while the person being locked out is usually the account's owner, who
otherwise sits retyping a password that cannot work until the window passes.

**Failures expire.** The count is over a rolling window, so five typos on
Monday and five on Friday are not a lockout. Only a run of failures inside the
window is.

Set ``LOGIN_LOCKOUT_ATTEMPTS`` to 0 to switch the whole mechanism off.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger("empportal.auth")


def _attempts() -> int:
    return int(getattr(settings, "LOGIN_LOCKOUT_ATTEMPTS", 0) or 0)


def _lock_minutes() -> int:
    return int(getattr(settings, "LOGIN_LOCKOUT_MINUTES", 15) or 15)


def _window_minutes() -> int:
    return int(getattr(settings, "LOGIN_LOCKOUT_WINDOW_MINUTES", 15) or 15)


def enabled() -> bool:
    return _attempts() > 0


def locked_until(user) -> timezone.datetime | None:
    """When the account's lock lifts, or ``None`` if it is not locked."""
    if not enabled() or user is None or user.locked_until is None:
        return None
    if user.locked_until <= timezone.now():
        return None
    return user.locked_until


def remaining_minutes(until) -> int:
    """Minutes left on a lock, rounded up - nobody counts in seconds."""
    seconds = (until - timezone.now()).total_seconds()
    return max(1, int(-(-seconds // 60)))


def register_failure(user) -> None:
    """Counts one wrong password, and locks the account at the threshold.

    A no-op for an address with no account: there is nothing to lock, and
    creating a record for one would build the very list this is protecting.
    """
    if not enabled() or user is None:
        return

    now = timezone.now()
    window = timedelta(minutes=_window_minutes())
    # A failure long after the last one starts a fresh run rather than adding
    # to a stale count.
    within_window = (
        user.last_failed_login_at is not None and now - user.last_failed_login_at <= window
    )
    count = (user.failed_login_count if within_window else 0) + 1

    user.failed_login_count = count
    user.last_failed_login_at = now
    if count >= _attempts():
        user.locked_until = now + timedelta(minutes=_lock_minutes())
        logger.warning(
            "Account locked after %s failed sign-ins: %s (until %s)",
            count,
            user.email,
            user.locked_until.isoformat(),
        )

    user.save(
        update_fields=[
            "failed_login_count",
            "last_failed_login_at",
            "locked_until",
            "updated_at",
        ]
    )


def clear(user) -> None:
    """Wipes the run after a successful sign-in.

    Written only when there is something to wipe: the overwhelming majority of
    sign-ins are clean, and they should not pay for a write.
    """
    if user is None:
        return
    if not user.failed_login_count and user.locked_until is None:
        return

    user.failed_login_count = 0
    user.locked_until = None
    user.last_failed_login_at = None
    user.save(
        update_fields=[
            "failed_login_count",
            "last_failed_login_at",
            "locked_until",
            "updated_at",
        ]
    )


def find_user(email: str):
    """The account a sign-in attempt names, if there is one."""
    from apps.authentication.models import User

    return User.objects.filter(email__iexact=(email or "").strip()).first()
