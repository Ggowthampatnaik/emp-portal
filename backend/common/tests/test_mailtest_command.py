"""The mailtest command.

It exists to answer "why is email not working", so what it prints matters as
much as what it sends: the settings actually in force, and a warning when the
console backend means nothing will leave the machine.
"""

from io import StringIO

import pytest
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError


@pytest.mark.django_db
def test_it_sends_and_says_so(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    out = StringIO()

    call_command("mailtest", "someone@example.com", stdout=out)

    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["someone@example.com"]
    assert "Sent to someone@example.com" in out.getvalue()


@pytest.mark.django_db
def test_it_reports_the_settings_in_force(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.EMAIL_HOST = "smtp.example.com"
    settings.EMAIL_PORT = 587
    out = StringIO()

    call_command("mailtest", "someone@example.com", stdout=out)
    printed = out.getvalue()

    assert "smtp.example.com" in printed
    assert "587" in printed


@pytest.mark.django_db
def test_it_never_prints_the_password(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.EMAIL_HOST_PASSWORD = "hunter2-should-not-appear"
    out = StringIO()

    call_command("mailtest", "someone@example.com", stdout=out)

    assert "hunter2-should-not-appear" not in out.getvalue()
    assert "(set)" in out.getvalue()


@pytest.mark.django_db
def test_it_warns_that_the_console_backend_sends_nothing(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
    out = StringIO()

    call_command("mailtest", "someone@example.com", stdout=out)

    assert "nothing will leave this machine" in out.getvalue()


@pytest.mark.django_db
def test_a_broken_relay_fails_loudly(settings):
    """Silent success is the bug this command exists to rule out."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = "127.0.0.1"
    settings.EMAIL_PORT = 1  # nothing listens here
    settings.EMAIL_TIMEOUT = 2

    with pytest.raises(CommandError) as raised:
        call_command("mailtest", "someone@example.com", stdout=StringIO())

    assert "EMAIL_HOST" in str(raised.value), "the message should point at what to check"
