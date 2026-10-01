"""Notification models.

Tables: notifications
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel


class Notification(TimeStampedModel):
    """An in-app message for one user, optionally emailed as well."""

    class Kind(models.TextChoices):
        LEAVE_APPLIED = "leave_applied", "Leave applied"
        LEAVE_APPROVED = "leave_approved", "Leave approved"
        LEAVE_REJECTED = "leave_rejected", "Leave rejected"
        LEAVE_CANCELLED = "leave_cancelled", "Leave cancelled"
        TIMESHEET_SUBMITTED = "timesheet_submitted", "Timesheet submitted"
        TIMESHEET_APPROVED = "timesheet_approved", "Timesheet approved"
        TIMESHEET_REJECTED = "timesheet_rejected", "Timesheet rejected"
        PROJECT_ASSIGNED = "project_assigned", "Project assigned"
        GENERAL = "general", "General"

    class Level(models.TextChoices):
        INFO = "info", "Info"
        SUCCESS = "success", "Success"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    kind = models.CharField(max_length=30, choices=Kind.choices, default=Kind.GENERAL)
    level = models.CharField(max_length=10, choices=Level.choices, default=Level.INFO)
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True)
    link = models.CharField(
        max_length=300, blank=True, help_text="Frontend route this notification points at."
    )
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    emailed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("recipient", "is_read", "-created_at"))]

    def __str__(self) -> str:
        return f"{self.recipient_id}: {self.title}"

    def mark_read(self) -> None:
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=["is_read", "read_at", "updated_at"])
