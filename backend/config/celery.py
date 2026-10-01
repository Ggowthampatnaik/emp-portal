"""Celery application for background jobs (notifications, reports, accruals)."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("emp_portal")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self) -> str:
    """Smoke-test task used to verify worker connectivity."""
    return f"celery ok: {self.request.id}"
