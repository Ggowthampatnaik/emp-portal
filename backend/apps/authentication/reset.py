"""Forgotten passwords (F17, decision D8).

The client chose the **temporary password** over a signed reset link, so this
issues one by email. The rules that make that safe:

* The endpoint answers the same way whether or not the address exists - an
  attacker must not learn who has an account here.
* Only the **hash** of the temporary password is stored, alongside the account
  password itself. Nothing anywhere can read it back out.
* It **expires** (30 minutes) and is **single use**: signing in with it consumes
  it, and the account is forced onto the change-password screen.
* **Asking changes nothing.** The account's real password keeps working, and
  every session it has stays signed in, until the temporary password is
  actually *used*. Only then does it replace the password and end the other
  sessions - because whoever asked for the reset may not be the person holding
  those sessions, and equally may not be the account's owner at all. The
  endpoint is unauthenticated: if asking alone replaced the password, anyone
  with the staff list could lock the whole company out on a schedule.

The signed 30-minute link is the eventual replacement (backlog B1). It changes
only how the credential reaches the person, so the code below is arranged with
that seam in mind: `issue_temporary_password` decides *what* the credential is
and `deliver_reset_email` decides *how it travels*.
"""

import logging
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.authentication.models import PasswordResetToken

logger = logging.getLogger("empportal.auth")

#: Long enough not to be guessable inside the window, short enough to retype.
TEMPORARY_PASSWORD_LENGTH = 12

#: Ambiguous characters removed: nobody should fail a reset over l versus 1.
ALPHABET = (
    "".join(c for c in string.ascii_uppercase if c not in "IO")
    + "".join(c for c in string.ascii_lowercase if c not in "l")
    + "".join(c for c in string.digits if c not in "01")
)


def reset_validity() -> timedelta:
    return timedelta(minutes=getattr(settings, "PASSWORD_RESET_MINUTES", 30))


def generate_temporary_password() -> str:
    """A readable one-time password. Includes a symbol so it clears validation."""
    body = "".join(secrets.choice(ALPHABET) for _ in range(TEMPORARY_PASSWORD_LENGTH - 1))
    return f"{body}#"


@transaction.atomic
def issue_temporary_password(user, requested_by_ip: str = "") -> str:
    """Records a temporary password for the account and returns it.

    The account itself is untouched: its password still works and its sessions
    stay open. The token row *is* the credential until it is used - see
    :func:`use_temporary_password`. The caller is responsible for delivering
    it; nothing here logs or persists the plain value.
    """
    temporary = generate_temporary_password()

    # Any earlier request is void: only the newest temporary password works.
    PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
        used_at=timezone.now()
    )

    PasswordResetToken.objects.create(
        user=user,
        token_hash=make_password(temporary),
        expires_at=timezone.now() + reset_validity(),
        requested_ip=requested_by_ip or None,
    )

    logger.info("Temporary password issued for %s", user.email)
    return temporary


def deliver_reset_email(user, temporary_password: str) -> None:
    """Sends the temporary password. Swap this out for the signed link (B1).

    Sent directly rather than through ``notify()``: a notification is a row in
    the database and a line in the in-app bell, and a temporary password has no
    business being in either.
    """
    minutes = int(reset_validity().total_seconds() // 60)
    send_mail(
        subject="[Employee Portal] Your temporary password",
        message=(
            f"Hello {user.first_name or 'there'},\n\n"
            "Someone asked to reset the password on your Trigyan Employee Portal "
            "account. Sign in with the temporary password below and you will be "
            "asked to choose a new one straight away.\n\n"
            f"    {temporary_password}\n\n"
            f"It works once, and only for the next {minutes} minutes. Your current "
            "password keeps working until you use this one, so if you did not ask "
            "for this you can simply ignore it.\n\n"
            "--\n"
            "Trigyan Employee Portal\n"
            "Empowering Ideas\n"
        ),
        from_email=None,  # DEFAULT_FROM_EMAIL
        recipient_list=[user.email],
        fail_silently=False,
    )


def issue_and_deliver(user_id: int, ip: str = "") -> bool:
    """Generates the temporary password and emails it - one unit of work.

    Runs on a worker, not in the request. If the email cannot leave the
    building the token is rolled back with it, so nothing is left behind that
    nobody received; the person simply asks again.
    """
    User = get_user_model()
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return False
    try:
        with transaction.atomic():
            deliver_reset_email(user, issue_temporary_password(user, ip))
    except Exception:
        logger.exception("Password reset email could not be delivered; no token was kept")
        return False
    return True


def request_password_reset(email: str, ip: str = "") -> bool:
    """The whole flow. Returns whether a reset was queued.

    The caller must **not** vary its response on the return value: it exists so
    the tests and the audit log can tell the two cases apart, not the client.

    Nothing expensive happens here, for either kind of address. Hashing the
    temporary password and the SMTP round-trip both used to run in the request,
    which made a known address answer measurably slower than an unknown one -
    the staff list, readable with a stopwatch. Both now happen on a worker,
    and the only thing the request does for a known address is publish a
    message carrying the user's id. No secret crosses the broker: the worker
    generates the temporary password itself.
    """
    User = get_user_model()
    user = User.objects.filter(email__iexact=email.strip(), is_active=True).first()
    if user is None:
        logger.info("Password reset requested for an unknown or inactive address")
        return False

    from apps.authentication.tasks import send_temporary_password

    try:
        queued = send_temporary_password.delay(user.pk, ip)
    except Exception:
        # A broker that is down. The answer to the client does not change.
        logger.exception("Password reset could not be queued")
        return False
    # With eager tasks (development, tests) the work has already run inline
    # and its result says whether the email left; on a real broker the result
    # is a pending handle and the queueing itself is the outcome.
    result = getattr(queued, "result", None)
    return result != "not sent"


@transaction.atomic
def use_temporary_password(user, raw_password: str) -> bool:
    """Called at sign-in when the password matched a live reset token.

    This is the moment the reset actually happens. The token is spent, so the
    temporary password works exactly once; it becomes the account password, so
    the forced change-password step can verify it as the current one; and the
    token version moves, so every session opened under the old password ends.
    Returns whether there was a live token to use.
    """
    # Locked, because "works exactly once" is the property this whole flow
    # rests on: without it two sign-ins arriving together both read the token
    # as unused and both mint a session.
    token = (
        PasswordResetToken.objects.select_for_update()
        .filter(user=user, used_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    if token is None or not check_password(raw_password, token.token_hash):
        return False
    if token.expires_at <= timezone.now():
        return False

    token.used_at = timezone.now()
    token.save(update_fields=["used_at"])

    user.set_password(raw_password)
    user.must_change_password = True
    user.token_version += 1
    user.save(update_fields=["password", "must_change_password", "token_version", "updated_at"])
    logger.info("Temporary password used for %s; earlier sessions ended", user.email)
    return True


def reset_token_state(user, raw_password: str) -> str:
    """Whether `raw_password` is a temporary one, and whether it still works.

    Returns ``"none"`` when the password is the account's own, ``"live"`` when
    it is an unused temporary password inside its window, and ``"spent"`` when
    it is a temporary password that has expired or already been used.

    Exactly one hash, always. This runs on every failed sign-in, so a variable
    number of hashes here is a stopwatch that answers "does this address have
    an account, and has it ever reset its password". Only the newest token can
    ever be live - issuing one voids the rest - so reaching further back buys
    nothing but a friendlier message for a superseded password.
    """
    tokens = PasswordResetToken.objects.filter(user=user).order_by("-created_at")[:1]
    for token in tokens:
        if not check_password(raw_password, token.token_hash):
            continue
        if token.used_at is not None or token.expires_at <= timezone.now():
            return "spent"
        return "live"
    return "none"
