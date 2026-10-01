"""Production refuses to start on a development configuration.

Three settings fail silently if they are wrong. The signing key is in this
repository, so running on it lets anybody holding a checkout forge a token for
any account. An empty host list with DEBUG off rejects every request, which
reads as a broken build rather than a missing variable. A console email backend
makes password resets appear to send and never arrive.

None of the three shows up in a smoke test of a running site, which is why they
stop the boot instead of logging a warning.
"""

import pytest
from django.core.exceptions import ImproperlyConfigured

from config.settings.guards import check_production_config

DEV_KEY = "insecure-dev-key-change-me"
SMTP = "django.core.mail.backends.smtp.EmailBackend"
CONSOLE = "django.core.mail.backends.console.EmailBackend"

GOOD = {
    "secret_key": "k7Xp2vQm9LzR4wN8bH3jT6yF1sA5dG0eC9uV2iO7pW4qE8rY1tU6nM3lK5zB",
    "insecure_secret_key": DEV_KEY,
    "allowed_hosts": ["portal.trigyan.io"],
    "email_backend": SMTP,
}


def test_a_complete_configuration_passes():
    check_production_config(**GOOD)


@pytest.mark.parametrize(
    ("override", "expected"),
    [
        pytest.param({"secret_key": DEV_KEY}, "DJANGO_SECRET_KEY", id="repository signing key"),
        pytest.param({"allowed_hosts": []}, "DJANGO_ALLOWED_HOSTS", id="no host list"),
        pytest.param({"email_backend": CONSOLE}, "EMAIL_HOST", id="console email"),
        pytest.param({"secret_key": "hunter2-but-longer"}, "at least 50", id="short signing key"),
    ],
)
def test_it_refuses_to_start(override, expected):
    with pytest.raises(ImproperlyConfigured) as raised:
        check_production_config(**{**GOOD, **override})

    # The message has to name the variable to set: whoever reads it is looking
    # at a container that will not start and nothing else.
    assert expected in str(raised.value)


def test_the_dev_default_is_still_the_one_being_guarded_against():
    """A rename in base.py would otherwise leave this guarding a dead string."""
    from config.settings.base import INSECURE_DEV_SECRET_KEY

    assert INSECURE_DEV_SECRET_KEY == DEV_KEY
