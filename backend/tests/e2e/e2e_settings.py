"""Settings for the end-to-end walkthroughs.

Identical to dev except for the database: the walkthroughs run against a
*copy* of `db.sqlite3`, so exercising the real workflows - approving leave,
processing payroll, closing accounts - cannot disturb the demo data somebody
is about to present from.

Email goes to a local outbox rather than the console, so a walkthrough can read
the message it just caused the way its recipient would.
"""

import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
#: Where the working copy of the database lives. Disposable; recreated each run.
RUN_DIR = HERE / ".run"

sys.path.insert(0, str(BACKEND))

os.environ.setdefault("USE_SQLITE", "1")
os.environ.setdefault("USE_LOCMEM_CACHE", "1")

from config.settings.dev import *  # noqa: E402, F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": str(RUN_DIR / "e2e.sqlite3"),
        "ATOMIC_REQUESTS": True,
    }
}

ALLOWED_HOSTS = ["*"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "e2e",
    }
}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_RESULT_BACKEND = "cache+memory://"
