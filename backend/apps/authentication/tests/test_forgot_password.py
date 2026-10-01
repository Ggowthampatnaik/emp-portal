"""Forgotten passwords (F17, decision D8).

This is the only endpoint an unauthenticated stranger can reach that touches an
account, so most of these tests are about what it refuses to tell them and how
little a stolen temporary password is worth.

The four rules: the response never reveals whether an address exists; the
temporary password expires; it works once; and issuing it kills every session
the account already had.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.hashers import check_password
from django.core import mail
from django.utils import timezone

from apps.authentication.models import PasswordResetToken
from apps.authentication.reset import issue_temporary_password, request_password_reset

FORGOT = "/api/v1/auth/password/forgot/"
LOGIN = "/api/v1/auth/login/"
PASSWORD = "Fixture@123"


def temporary_password_from_email() -> str:
    """Pulls the generated password out of the message that was sent."""
    body = mail.outbox[-1].body
    # It is the only indented line: "    Ab3dEf9hJk#"
    return next(line.strip() for line in body.splitlines() if line.startswith("    "))


@pytest.fixture(autouse=True)
def _empty_outbox():
    mail.outbox.clear()


# ---------------------------------------------------------------------------
# What it tells a stranger
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_known_address_gets_a_temporary_password(api_client, org):
    response = api_client.post(FORGOT, {"email": org["employee"].email})

    assert response.status_code == 204
    assert len(mail.outbox) == 1
    assert org["employee"].email in mail.outbox[0].to


@pytest.mark.django_db
def test_an_unknown_address_looks_exactly_the_same(api_client, org):
    """Otherwise this endpoint is a free "does this person work here?" oracle."""
    known = api_client.post(FORGOT, {"email": org["employee"].email})
    unknown = api_client.post(FORGOT, {"email": "nobody@trigyan.io"})

    assert unknown.status_code == known.status_code == 204
    assert unknown.content == known.content == b""


@pytest.mark.django_db
def test_nothing_is_sent_to_an_unknown_address(api_client, org):
    api_client.post(FORGOT, {"email": "nobody@trigyan.io"})
    assert mail.outbox == []


@pytest.mark.django_db
def test_a_deactivated_account_gets_nothing_but_the_same_answer(api_client, org):
    """A closed account must not be reopened by asking nicely."""
    leaver = org["employee"].user
    leaver.is_active = False
    leaver.save(update_fields=["is_active"])

    response = api_client.post(FORGOT, {"email": leaver.email})

    assert response.status_code == 204
    assert mail.outbox == []


@pytest.mark.django_db
def test_a_malformed_address_is_a_normal_validation_error(api_client):
    response = api_client.post(FORGOT, {"email": "not-an-address"})
    assert response.status_code == 400
    assert "email" in response.data["error"]["details"]


# ---------------------------------------------------------------------------
# What is stored
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_only_the_hash_is_kept(api_client, org):
    api_client.post(FORGOT, {"email": org["employee"].email})
    temporary = temporary_password_from_email()

    token = PasswordResetToken.objects.get(user=org["employee"].user)
    assert token.token_hash != temporary, "the plain password must never be stored"
    assert check_password(temporary, token.token_hash)


@pytest.mark.django_db
def test_it_expires_in_thirty_minutes(org):
    issue_temporary_password(org["employee"].user)

    token = PasswordResetToken.objects.get(user=org["employee"].user)
    window = token.expires_at - timezone.now()
    assert timedelta(minutes=29) < window <= timedelta(minutes=30)


@pytest.mark.django_db
def test_asking_twice_voids_the_first_one(org):
    first = issue_temporary_password(org["employee"].user)
    issue_temporary_password(org["employee"].user)

    tokens = PasswordResetToken.objects.filter(user=org["employee"].user)
    assert tokens.count() == 2
    assert tokens.filter(used_at__isnull=True).count() == 1, "only the newest is live"

    # And the first one no longer opens the door. It now reads as an ordinary
    # wrong password rather than "already used": only the newest token is
    # hashed against, so that a failed sign-in costs one hash for every
    # account and cannot be timed (SR-20). A superseded password *is* wrong.
    from apps.authentication.reset import reset_token_state

    assert reset_token_state(org["employee"].user, first) == "none"


@pytest.mark.django_db
def test_the_email_never_repeats_the_address_back_as_a_link(api_client, org):
    """Nothing in the message should be usable without the mailbox itself."""
    api_client.post(FORGOT, {"email": org["employee"].email})

    body = mail.outbox[0].body
    assert "http" not in body, "a temporary password needs no clickable link"


# ---------------------------------------------------------------------------
# Signing in with it
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_old_password_keeps_working_until_the_temporary_one_is_used(api_client, org):
    """Asking is unauthenticated. If asking alone replaced the password, anyone
    with the staff list could lock the whole company out on a schedule."""
    api_client.post(FORGOT, {"email": org["employee"].email})

    still_works = api_client.post(LOGIN, {"email": org["employee"].email, "password": PASSWORD})
    assert still_works.status_code == 200

    temporary = temporary_password_from_email()
    used = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})
    assert used.status_code == 200

    # Now, and only now, the old one is gone.
    replaced = api_client.post(LOGIN, {"email": org["employee"].email, "password": PASSWORD})
    assert replaced.status_code == 400


@pytest.mark.django_db
def test_a_stranger_asking_for_a_reset_changes_nothing_for_the_owner(api_client, auth_client, org):
    signed_in = auth_client(org["employee"])

    for _ in range(3):
        api_client.post(FORGOT, {"email": org["employee"].email})

    assert signed_in.get("/api/v1/auth/me/").status_code == 200, "sessions survive"
    fresh = api_client.post(LOGIN, {"email": org["employee"].email, "password": PASSWORD})
    assert fresh.status_code == 200, "and so does the password"
    assert fresh.data["user"]["must_change_password"] is False


@pytest.mark.django_db
def test_the_temporary_password_signs_in_and_forces_a_change(api_client, org):
    api_client.post(FORGOT, {"email": org["employee"].email})
    temporary = temporary_password_from_email()

    response = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})

    assert response.status_code == 200, response.data
    assert response.data["user"]["must_change_password"] is True


@pytest.mark.django_db
def test_it_works_exactly_once(api_client, org):
    api_client.post(FORGOT, {"email": org["employee"].email})
    temporary = temporary_password_from_email()

    first = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})
    second = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})

    assert first.status_code == 200
    assert second.status_code == 400
    assert "already been used" in second.data["error"]["message"]


@pytest.mark.django_db
def test_an_expired_one_is_refused(api_client, org):
    api_client.post(FORGOT, {"email": org["employee"].email})
    temporary = temporary_password_from_email()

    token = PasswordResetToken.objects.get(user=org["employee"].user)
    token.expires_at = timezone.now() - timedelta(minutes=1)
    token.save(update_fields=["expires_at"])

    response = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})

    assert response.status_code == 400
    assert "expired" in response.data["error"]["message"]


@pytest.mark.django_db
def test_the_message_says_what_to_do_next(api_client, org):
    api_client.post(FORGOT, {"email": org["employee"].email})
    temporary = temporary_password_from_email()
    api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})

    response = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})
    assert "Request a new one" in response.data["error"]["message"]


# ---------------------------------------------------------------------------
# Existing sessions
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_using_the_temporary_password_ends_every_earlier_session(api_client, auth_client, org):
    """Whoever asked for the reset may not be the person holding those tokens -
    and equally may not be the owner, which is why issuing alone ends nothing."""
    signed_in = auth_client(org["employee"])
    assert signed_in.get("/api/v1/auth/me/").status_code == 200

    api_client.post(FORGOT, {"email": org["employee"].email})
    assert signed_in.get("/api/v1/auth/me/").status_code == 200, "asking ends nothing"

    api_client.post(
        LOGIN, {"email": org["employee"].email, "password": temporary_password_from_email()}
    )

    assert signed_in.get("/api/v1/auth/me/").status_code == 401, "using it does"


@pytest.mark.django_db
def test_the_refusal_explains_itself(api_client, auth_client, org):
    signed_in = auth_client(org["employee"])
    api_client.post(FORGOT, {"email": org["employee"].email})
    api_client.post(
        LOGIN, {"email": org["employee"].email, "password": temporary_password_from_email()}
    )

    response = signed_in.get("/api/v1/auth/me/")
    assert "password was reset" in str(response.data)


@pytest.mark.django_db
def test_other_accounts_are_untouched(api_client, auth_client, org):
    peer = auth_client(org["peer"])
    issue_temporary_password(org["employee"].user)

    assert peer.get("/api/v1/auth/me/").status_code == 200


@pytest.mark.django_db
def test_signing_in_again_afterwards_works(api_client, org):
    api_client.post(FORGOT, {"email": org["employee"].email})
    temporary = temporary_password_from_email()

    response = api_client.post(LOGIN, {"email": org["employee"].email, "password": temporary})
    assert response.status_code == 200
    assert response.data["access"], "a fresh token, on the new version"


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------
def test_the_endpoint_uses_the_same_throttle_scope_as_sign_in():
    """Guessing an address here is the same attack as guessing a password."""
    from apps.authentication.views import LoginView, PasswordForgotView

    assert PasswordForgotView.throttle_scope == LoginView.throttle_scope == "login"


@pytest.mark.django_db
def test_throttling_engages_when_it_is_switched_on(api_client, org):
    """The test settings disable throttling, so it is turned on just here.

    Without this the scope above is only a label - nothing would notice if the
    throttle class stopped being applied in production.
    """
    from unittest.mock import patch

    from django.core.cache import cache
    from rest_framework.throttling import ScopedRateThrottle

    cache.clear()

    class ThreePerMinute(ScopedRateThrottle):
        THROTTLE_RATES = {"login": "3/min"}

    from apps.authentication.views import PasswordForgotView

    with patch.object(PasswordForgotView, "throttle_classes", [ThreePerMinute]):
        codes = [
            api_client.post(FORGOT, {"email": org["employee"].email}).status_code for _ in range(5)
        ]

    cache.clear()
    assert codes[:3] == [204, 204, 204]
    assert codes[3:] == [429, 429], f"expected the fourth to be refused, got {codes}"


@pytest.mark.django_db
def test_the_service_reports_whether_it_sent_anything(org):
    """For the audit trail - never for the response body."""
    assert request_password_reset(org["employee"].email) is True
    assert request_password_reset("nobody@trigyan.io") is False


# ---------------------------------------------------------------------------
# When the mail cannot leave the building
# ---------------------------------------------------------------------------
# Issuing a temporary password voids the account's real one. If the email then
# fails - a relay that refuses the connection, credentials the host rejects -
# the person is locked out of an account they could have signed into a second
# earlier, and nothing on screen says why. So the reset has to undo itself.
def unsendable():
    """Patches delivery to fail the way a misconfigured relay does."""
    from smtplib import SMTPException
    from unittest.mock import patch

    return patch(
        "apps.authentication.reset.deliver_reset_email",
        side_effect=SMTPException("relay refused the connection"),
    )


@pytest.mark.django_db
def test_a_failed_send_leaves_the_old_password_working(org):
    user = org["employee"].user
    before = user.password

    with unsendable():
        assert request_password_reset(user.email) is False

    user.refresh_from_db()
    assert user.password == before, "the account password must be untouched"
    assert user.check_password(PASSWORD)
    assert not user.must_change_password


@pytest.mark.django_db
def test_a_failed_send_leaves_no_token_behind(org):
    user = org["employee"].user

    with unsendable():
        request_password_reset(user.email)

    assert not PasswordResetToken.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_a_failed_send_does_not_retire_existing_sessions(org):
    """Issuing bumps token_version to kill live sessions. Rolling back has to
    put that back too, or everyone stays signed out for nothing."""
    user = org["employee"].user
    before = user.token_version

    with unsendable():
        request_password_reset(user.email)

    user.refresh_from_db()
    assert user.token_version == before


@pytest.mark.django_db
def test_a_failed_send_still_answers_the_same_way(api_client, org):
    """The endpoint's silence has to hold even when the mail host is down -
    otherwise a broken relay turns it into an account-existence oracle."""
    with unsendable():
        known = api_client.post(FORGOT, {"email": org["employee"].email})
        unknown = api_client.post(FORGOT, {"email": "nobody@trigyan.io"})

    assert known.status_code == 204
    assert unknown.status_code == 204


@pytest.mark.django_db
def test_the_old_password_still_signs_in_after_a_failed_send(api_client, org):
    """The rollback is only real if the account is usable afterwards."""
    user = org["employee"].user
    with unsendable():
        api_client.post(FORGOT, {"email": user.email})

    response = api_client.post(LOGIN, {"email": user.email, "password": PASSWORD})
    assert response.status_code == 200, response.data


# ---------------------------------------------------------------------------
# Nothing expensive happens in the request
# ---------------------------------------------------------------------------
# Hashing the temporary password and the SMTP round-trip used to run inside
# the request, so a known address answered measurably slower than an unknown
# one - the staff list, readable with a stopwatch. Both now happen on a worker.
@pytest.mark.django_db
def test_a_known_address_only_queues_a_message(org):
    from unittest.mock import patch

    with patch("apps.authentication.tasks.send_temporary_password.delay") as queued:
        assert request_password_reset(org["employee"].email) is True

    queued.assert_called_once()
    (user_id, _ip), _ = queued.call_args
    assert user_id == org["employee"].user.pk
    # The request itself minted nothing: no token, no hash, no email.
    assert not PasswordResetToken.objects.filter(user=org["employee"].user).exists()
    assert mail.outbox == []


@pytest.mark.django_db
def test_an_unknown_address_queues_nothing(org):
    from unittest.mock import patch

    with patch("apps.authentication.tasks.send_temporary_password.delay") as queued:
        assert request_password_reset("nobody@trigyan.io") is False

    queued.assert_not_called()


@pytest.mark.django_db
def test_the_worker_never_receives_the_secret(org):
    """Only the user's id crosses the broker; the worker mints the password."""
    from unittest.mock import patch

    with patch("apps.authentication.tasks.send_temporary_password.delay") as queued:
        request_password_reset(org["employee"].email)

    args, _kwargs = queued.call_args
    assert all(isinstance(value, (int, str)) and len(str(value)) < 64 for value in args)
    assert not any("#" in str(value) for value in args), "a temporary password ends in #"
