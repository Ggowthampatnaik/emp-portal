"""Local development settings."""

from .base import *  # noqa: F403
from .base import BASE_DIR, CORS_ALLOWED_ORIGINS, SPECTACULAR_SETTINGS, env

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "backend"]
# base.py defaults this to DEBUG, but DEBUG is read there before this file
# turns it on - say it plainly.
DJANGO_ADMIN_ENABLED = env.bool("DJANGO_ADMIN_ENABLED", default=True)

# Swagger at /api/docs/ is part of the local workflow; only production keeps
# the schema behind a staff account.
SPECTACULAR_SETTINGS = {
    **SPECTACULAR_SETTINGS,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.AllowAny"],
}

CORS_ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS or [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Docker Compose provides PostgreSQL and Redis. When working without Docker,
# set USE_SQLITE=1 / USE_LOCMEM_CACHE=1 in .env so the stack still boots.
# CI, staging and production always run PostgreSQL + Redis.
if env.bool("USE_SQLITE", default=False):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
            "ATOMIC_REQUESTS": True,
        }
    }

if env.bool("USE_LOCMEM_CACHE", default=False):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "emp-portal-dev",
        }
    }
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_RESULT_BACKEND = "cache+memory://"
