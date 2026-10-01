"""Production settings for Render: managed PostgreSQL, uploads on a Render
persistent disk, and no Redis.

Everything in prod.py still applies - HTTPS, HSTS, the refusal to start on the
repository's signing key or without SMTP. What changes is the infrastructure
around it: Azure Blob Storage, Redis and the Celery worker are replaced by what
a single Render web service already has. See DEPLOY_RENDER.md.
"""

from .base import BASE_DIR
from .prod import *  # noqa: F403
from .prod import ALLOWED_HOSTS, STORAGES, env

# --- Hosts ------------------------------------------------------------------
# Render sets RENDER_EXTERNAL_HOSTNAME (emp-portal-api.onrender.com) on every
# web service. Accepting it means the service answers on its own address even
# before a custom domain is added to DJANGO_ALLOWED_HOSTS.
RENDER_EXTERNAL_HOSTNAME = env("RENDER_EXTERNAL_HOSTNAME", default="")
if RENDER_EXTERNAL_HOSTNAME and RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS:
    ALLOWED_HOSTS = [*ALLOWED_HOSTS, RENDER_EXTERNAL_HOSTNAME]

# Render's health check calls the container directly over plain HTTP. A 301 to
# https:// would only obscure what the probe is asking.
SECURE_REDIRECT_EXEMPT = [r"^healthz/$"]

# --- Uploaded documents live on the attached Render disk --------------------
# Django serves them itself, so every link is signed and checked (see
# common/media.py) - the protection Azure's SAS URLs gave in prod.py. The disk
# must be mounted at MEDIA_ROOT: the container's own filesystem is wiped on
# every deploy.
MEDIA_ROOT = env.path("MEDIA_ROOT", default=str(BASE_DIR / "media"))
STORAGES = {**STORAGES, "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"}}
MEDIA_SIGNING = True

# --- No Redis ---------------------------------------------------------------
# The cache holds login lockouts and rate limits, which every gunicorn worker
# must share - so it lives in the database, not in each process's memory. The
# start command runs `createcachetable`, which is a no-op once it exists.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "django_cache",
        "KEY_PREFIX": "empportal",
    }
}
# Without a broker, background jobs (emails) run inside the request.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_BROKER_URL = "memory://"
