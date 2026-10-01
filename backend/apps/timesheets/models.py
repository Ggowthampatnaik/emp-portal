"""Timesheet Management models.

Tables: timesheets, timesheet_entries, timesheet_approvals

A timesheet is one employee's week (Monday-Sunday). Entries hang off it, one per
project per day, so the weekly grid is a simple pivot of the entry rows.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum

from apps.employees.models import Employee
from apps.projects.models import Project
from common.enums import ApprovalStatus
from common.models import TimeStampedModel

MAX_HOURS_PER_DAY = Decimal("24")
STANDARD_WEEK_HOURS = Decimal("40")


class Timesheet(TimeStampedModel):
    """One week of work for one employee."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="timesheets")
    week_start_date = models.DateField(help_text="Always a Monday.")
    status = models.CharField(
        max_length=12, choices=ApprovalStatus.choices, default=ApprovalStatus.DRAFT, db_index=True
    )
    total_hours = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0"))
    comments = models.TextField(blank=True)

    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="timesheet_decisions",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_comment = models.TextField(blank=True)

    class Meta:
        db_table = "timesheets"
        ordering = ("-week_start_date",)
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "week_start_date"), name="uniq_timesheet_per_week"
            )
        ]
        indexes = [models.Index(fields=("status", "week_start_date"))]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} week of {self.week_start_date}"

    @property
    def week_end_date(self) -> date:
        return self.week_start_date + timedelta(days=6)

    @property
    def is_editable(self) -> bool:
        """Only drafts and rejected sheets accept entry changes."""
        return self.status in {ApprovalStatus.DRAFT, ApprovalStatus.REJECTED}

    @property
    def is_locked(self) -> bool:
        return self.status == ApprovalStatus.APPROVED

    def recalculate_total(self, save: bool = True) -> Decimal:
        total = self.entries.aggregate(total=Sum("hours"))["total"] or Decimal("0")
        self.total_hours = total
        if save:
            self.save(update_fields=["total_hours", "updated_at"])
        return total


class TimesheetEntry(TimeStampedModel):
    """Hours booked to one project on one day."""

    timesheet = models.ForeignKey(Timesheet, on_delete=models.CASCADE, related_name="entries")
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="timesheet_entries")
    work_date = models.DateField()
    hours = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.25")), MaxValueValidator(MAX_HOURS_PER_DAY)],
    )
    description = models.CharField(max_length=500, blank=True)
    is_billable = models.BooleanField(default=True)

    class Meta:
        db_table = "timesheet_entries"
        ordering = ("work_date", "project__code")
        constraints = [
            models.UniqueConstraint(
                fields=("timesheet", "project", "work_date"), name="uniq_entry_per_project_day"
            )
        ]
        indexes = [models.Index(fields=("work_date",)), models.Index(fields=("project",))]

    def __str__(self) -> str:
        return f"{self.work_date} {self.project.code} {self.hours}h"


class TimesheetApproval(TimeStampedModel):
    """Decision history for a timesheet."""

    class Action(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        REOPENED = "reopened", "Reopened"

    timesheet = models.ForeignKey(Timesheet, on_delete=models.CASCADE, related_name="approvals")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=12, choices=Action.choices)
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "timesheet_approvals"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.timesheet_id} {self.action}"
