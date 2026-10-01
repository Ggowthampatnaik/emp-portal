"""Configuration that production must not start without.

Each of these fails silently on a running site, which is what makes them worth
a refusal rather than a warning. The checks live here, apart from the settings
module that calls them, so they can be exercised directly: reloading a settings
module inside a test process does not re-evaluate the base module it imported
its values from, so a test written against the module would pass whatever the
environment said.
"""

from django.core.exceptions import ImproperlyConfigured

#: What `django-admin startproject` generates; anything shorter was typed.
MIN_SECRET_KEY_LENGTH = 50


def check_production_config(
    *,
    secret_key: str,
    insecure_secret_key: str,
    allowed_hosts: list[str],
    email_backend: str,
) -> None:
    """Raises on the configuration mistakes a deployment cannot see it made."""
    # The signing key is public - it is in the repository. Running on it means
    # anybody holding a checkout can mint a token for any account here, and
    # nothing in the logs would look wrong.
    if secret_key == insecure_secret_key:
        raise ImproperlyConfigured(
            "Set DJANGO_SECRET_KEY - production must not run on the development "
            "signing key, which is public in the repository."
        )

    # Django's own generator makes 50 characters; HS256 wants 32 bytes at the
    # least. A short key is one that was typed by hand, which is to say
    # guessed - and every token the portal issues is signed with it.
    if len(secret_key) < MIN_SECRET_KEY_LENGTH:
        raise ImproperlyConfigured(
            f"DJANGO_SECRET_KEY must be at least {MIN_SECRET_KEY_LENGTH} characters. "
            'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(64))"'
        )

    # With DEBUG off, an empty host list rejects every request. That reads as a
    # broken deployment rather than a missing setting, so it is said plainly.
    if not allowed_hosts:
        raise ImproperlyConfigured(
            "Set DJANGO_ALLOWED_HOSTS - with DEBUG off an empty list rejects every request."
        )

    # Mail that vanishes into a container's stdout is worse than a container
    # that will not boot: the password reset appears to work and never arrives.
    if email_backend.endswith("console.EmailBackend"):
        raise ImproperlyConfigured(
            "Set EMAIL_HOST (or override EMAIL_BACKEND) - production must not "
            "print email to the console."
        )
