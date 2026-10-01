"""Settings used by pytest (fast, isolated, no external services)."""

from .base import *  # noqa: F403
from .base import BASE_DIR

DEBUG = False
ALLOWED_HOSTS = ["*"]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "test_db.sqlite3",
        "ATOMIC_REQUESTS": True,
        "TEST": {"NAME": ":memory:"},
    }
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "emp-portal-test",
    }
}

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_RESULT_BACKEND = "cache+memory://"
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# As in production: the maintenance admin is not routed. tests/test_admin_exposure.py
# reloads the url table to exercise the switch.
DJANGO_ADMIN_ENABLED = False

# Rate limiting is exercised by its own test, not by every other one.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_CLASSES": (),
    "DEFAULT_THROTTLE_RATES": {},
}
