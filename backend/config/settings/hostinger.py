"""Production settings for a Hostinger VPS: MySQL/MariaDB, uploads on local
disk, and no Redis.

Everything in prod.py still applies - HTTPS, HSTS, the refusal to start on the
repository's signing key or without SMTP. What changes is the infrastructure
around it: Azure Blob Storage, Redis and the Celery worker are replaced by what
a single server already has.
"""

from .prod import *  # noqa: F403
from .prod import STORAGES, env

# --- Database ---------------------------------------------------------------
# DATABASE_URL=mysql://user:password@localhost:3306/dbname
# utf8mb4 so names and notes in any script survive; strict mode so MySQL
# refuses bad data instead of silently truncating it.
DATABASES = {
    "default": {
        **env.db_url("DATABASE_URL"),
        "ATOMIC_REQUESTS": True,
        "CONN_MAX_AGE": env.int("DB_CONN_MAX_AGE", default=60),
        "OPTIONS": {
            "charset": "utf8mb4",
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}

# --- Uploaded documents stay on the server's disk ----------------------------
# Django serves them itself, so every link is signed and checked (see
# common/media.py) - the protection Azure's SAS URLs gave in prod.py.
STORAGES = {**STORAGES, "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"}}
MEDIA_SIGNING = True

# --- No Redis ---------------------------------------------------------------
# The cache holds login lockouts and rate limits, which every worker process
# must share - so it lives in the database, not in each process's memory.
# Run `python manage.py createcachetable` once (the SQL dump already has it).
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
