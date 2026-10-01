"""Brute-force lockout on password sign-in.

The throttle in front of this endpoint counts requests per address, so it does
nothing about the same account being guessed at from many addresses. These pin
the account-side counter: it locks at the threshold, it refuses even the right
password while the lock holds, a successful sign-in wipes the run, and failures
spread out over time never accumulate into a lock.
"""

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework import status

from apps.authentication import lockout

LOGIN_URL = "/api/v1/auth/login/"
PASSWORD = "Portal@123"
WRONG = "not-the-password"


def sign_in(api_client, email, password):
    return api_client.post(LOGIN_URL, {"email": email, "password": password}, format="json")


@pytest.fixture
def account(employee_user):
    employee_user.set_password(PASSWORD)
    employee_user.save(update_fields=["password"])
    return employee_user


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3, LOGIN_LOCKOUT_MINUTES=15)
def test_the_account_locks_at_the_threshold(api_client, account):
    for _ in range(2):
        assert sign_in(api_client, account.email, WRONG).status_code == 400

    account.refresh_from_db()
    assert account.locked_until is None, "two failures is not a lockout"

    third = sign_in(api_client, account.email, WRONG)
    assert third.status_code == 400

    account.refresh_from_db()
    assert account.locked_until is not None
    assert account.failed_login_count == 3


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3, LOGIN_LOCKOUT_MINUTES=15)
def test_the_right_password_is_refused_while_locked(api_client, account):
    for _ in range(3):
        sign_in(api_client, account.email, WRONG)

    # The point of the lock: knowing the password is not what ends it.
    response = sign_in(api_client, account.email, PASSWORD)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["error"]["code"] == "account_locked"
    assert "Try again in" in response.json()["error"]["message"]


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3, LOGIN_LOCKOUT_MINUTES=15)
def test_signing_in_again_once_the_lock_lifts(api_client, account):
    for _ in range(3):
        sign_in(api_client, account.email, WRONG)

    account.refresh_from_db()
    account.locked_until = timezone.now() - timedelta(seconds=1)
    account.save(update_fields=["locked_until"])

    response = sign_in(api_client, account.email, PASSWORD)

    assert response.status_code == status.HTTP_200_OK
    account.refresh_from_db()
    assert account.failed_login_count == 0
    assert account.locked_until is None


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3)
def test_a_correct_password_clears_the_run(api_client, account):
    sign_in(api_client, account.email, WRONG)
    sign_in(api_client, account.email, WRONG)

    assert sign_in(api_client, account.email, PASSWORD).status_code == 200

    account.refresh_from_db()
    assert account.failed_login_count == 0
    # And the next two failures start from nothing rather than tipping it over.
    sign_in(api_client, account.email, WRONG)
    account.refresh_from_db()
    assert account.failed_login_count == 1


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3, LOGIN_LOCKOUT_WINDOW_MINUTES=15)
def test_failures_outside_the_window_do_not_accumulate(api_client, account):
    sign_in(api_client, account.email, WRONG)
    sign_in(api_client, account.email, WRONG)

    # Two typos this morning should not join a third one tomorrow.
    account.refresh_from_db()
    account.last_failed_login_at = timezone.now() - timedelta(hours=3)
    account.save(update_fields=["last_failed_login_at"])

    sign_in(api_client, account.email, WRONG)

    account.refresh_from_db()
    assert account.failed_login_count == 1
    assert account.locked_until is None


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3)
def test_an_address_with_no_account_is_not_recorded(api_client, django_user_model):
    before = django_user_model.objects.count()

    for _ in range(4):
        response = sign_in(api_client, "nobody@trigyan.io", WRONG)
        # The same answer a real account gives to a wrong password: this
        # endpoint must not become a way to find out who works here.
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_credentials"

    assert django_user_model.objects.count() == before


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=0)
def test_the_whole_mechanism_can_be_switched_off(api_client, account):
    for _ in range(6):
        sign_in(api_client, account.email, WRONG)

    account.refresh_from_db()
    assert account.locked_until is None
    assert not lockout.enabled()
    assert sign_in(api_client, account.email, PASSWORD).status_code == 200


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3)
def test_a_locked_account_is_locked_for_sso_too(api_client, account, monkeypatch):
    """The lock is raised by password guessing, and an Entra token is proof
    guessing cannot forge - but ten failures is a reason to hold the account,
    not a reason to hold one door and leave the other open."""
    for _ in range(3):
        sign_in(api_client, account.email, WRONG)

    monkeypatch.setattr(
        "apps.authentication.authentication.validate_entra_token",
        lambda token: {
            "oid": "aaaaaaaa-0000-0000-0000-000000000009",
            "tid": "",
            "preferred_username": account.email,
            "amr": ["pwd", "mfa"],
        },
    )
    api_client.credentials(HTTP_AUTHORIZATION="Bearer pretend-entra-token")
    response = api_client.post("/api/v1/auth/entra/exchange/", {}, format="json")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_locked"


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3)
def test_the_audit_trail_records_the_failures_and_the_lock(api_client, account):
    """The application log rotates; the audit trail is the record that is kept,
    and it is where anyone would look to ask whether an account was attacked."""
    from apps.administration.models import AuditLog

    for _ in range(3):
        sign_in(api_client, account.email, WRONG)
    sign_in(api_client, account.email, PASSWORD)  # refused, the lock holds

    failures = AuditLog.objects.filter(action="login_failed")
    assert failures.count() == 3
    assert failures.first().actor is None, "nobody signed in; there is no actor"
    assert account.email in str(failures.first().changes)
    assert AuditLog.objects.filter(action="locked_out").exists()


@pytest.mark.django_db
@override_settings(LOGIN_LOCKOUT_ATTEMPTS=3)
def test_an_address_with_no_account_is_still_recorded(api_client, django_user_model):
    """A run of attempts against addresses that do not exist is the clearest
    signal there is - and no account row is created to hold it."""
    from apps.administration.models import AuditLog

    before = django_user_model.objects.count()
    sign_in(api_client, "nobody@trigyan.io", WRONG)

    entry = AuditLog.objects.filter(action="login_failed").first()
    assert entry is not None
    assert "nobody@trigyan.io" in str(entry.changes)
    assert django_user_model.objects.count() == before
