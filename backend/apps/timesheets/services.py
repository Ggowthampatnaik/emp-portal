"""Timesheet workflow.

    save entries -> only on a draft or rejected sheet
    submit       -> draft/rejected -> pending, notify the manager
    approve      -> pending -> approved (locked), notify the employee
    reject       -> pending -> rejected (editable again), notify the employee

Rules enforced here rather than in the view:
  * the work date must fall inside the sheet's week
  * total hours booked on one day may not exceed 24
  * hours may only be booked to a project the employee is allocated to
  * an approved sheet is immutable
"""

import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.projects.models import Project, ProjectAllocation
from apps.timesheets.models import (
    MAX_HOURS_PER_DAY,
    Timesheet,
    TimesheetApproval,
    TimesheetEntry,
)
from common.enums import ApprovalStatus, EmploymentStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError
from common.humanize import human_date, human_range

logger = logging.getLogger("empportal.timesheets")


def week_start(any_day: date) -> date:
    """The Monday of the week containing ``any_day``."""
    return any_day - timedelta(days=any_day.weekday())


def last_completed_week(today: date | None = None) -> date:
    """The Monday of the most recently *finished* week.

    The current week is not due yet, so chasing people for it would be noise.
    This is the week HR's submission tracking reports on.
    """
    today = today or timezone.localdate()
    return week_start(today) - timedelta(days=7)


def get_or_create_timesheet(employee: Employee, any_day: date) -> Timesheet:
    monday = week_start(any_day)
    timesheet, _ = Timesheet.objects.get_or_create(
        employee=employee, week_start_date=monday, defaults={"status": ApprovalStatus.DRAFT}
    )
    return timesheet


def allocated_project_ids(employee: Employee) -> set[int]:
    return set(
        ProjectAllocation.objects.filter(employee=employee, is_active=True).values_list(
            "project_id", flat=True
        )
    )


def approver_for(employee: Employee):
    manager = employee.reporting_manager
    return manager.user if manager else None


# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------
@transaction.atomic
def save_entries(timesheet: Timesheet, rows: list[dict]) -> Timesheet:
    """Replaces the sheet's entries with ``rows``.

    A full replace keeps the client simple: the weekly grid posts what it shows,
    and deletions need no separate call.
    """
    if not timesheet.is_editable:
        raise WorkflowStateError(
            f"This timesheet is {timesheet.get_status_display().lower()} and cannot be edited."
        )

    allowed_projects = allocated_project_ids(timesheet.employee)
    week_days = {timesheet.week_start_date + timedelta(days=offset) for offset in range(7)}
    # Hours are a report of work done, so there is nothing to report for a day
    # that has not happened. `localdate` rather than `date.today`, so the cutoff
    # is midnight where the company is rather than in UTC.
    today = timezone.localdate()

    per_day: dict[date, Decimal] = {}
    cleaned: list[dict] = []

    for row in rows:
        work_date = row["work_date"]
        hours = Decimal(str(row["hours"]))
        project = row["project"]

        if hours <= 0:
            continue  # a zeroed cell means "no booking"
        if work_date not in week_days:
            raise BusinessRuleViolation(
                f"{work_date} is outside the week beginning {timesheet.week_start_date}."
            )
        if work_date > today:
            raise BusinessRuleViolation(
                f"{work_date} has not happened yet. Hours can only be booked " "up to today."
            )
        project_id = project.pk if isinstance(project, Project) else int(project)
        if allowed_projects and project_id not in allowed_projects:
            raise BusinessRuleViolation(
                "You can only book hours to projects you are allocated to. "
                "Ask your manager for an allocation first."
            )

        per_day[work_date] = per_day.get(work_date, Decimal("0")) + hours
        if per_day[work_date] > MAX_HOURS_PER_DAY:
            raise BusinessRuleViolation(
                f"{work_date} would total {per_day[work_date]} hours; "
                f"the maximum is {MAX_HOURS_PER_DAY}."
            )
        cleaned.append(
            {
                "project_id": project_id,
                "work_date": work_date,
                "hours": hours,
                "description": row.get("description", "") or "",
                "is_billable": row.get("is_billable", True),
            }
        )

    timesheet.entries.all().delete()
    TimesheetEntry.objects.bulk_create(
        [TimesheetEntry(timesheet=timesheet, **row) for row in cleaned]
    )
    timesheet.recalculate_total()
    return timesheet


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------
@transaction.atomic
def submit_timesheet(timesheet_id: int, actor, comment: str = "") -> Timesheet:
    timesheet = (
        Timesheet.objects.select_for_update().select_related("employee__user").get(pk=timesheet_id)
    )

    if timesheet.status == ApprovalStatus.PENDING:
        raise WorkflowStateError("This timesheet has already been submitted.")
    if timesheet.status == ApprovalStatus.APPROVED:
        raise WorkflowStateError("An approved timesheet cannot be resubmitted.")

    timesheet.recalculate_total(save=False)
    if timesheet.total_hours <= 0:
        raise BusinessRuleViolation("Add at least one entry before submitting.")

    # A timesheet without task descriptions tells the approver nothing, so the
    # description is required at submission rather than at save - people fill the
    # grid first and write it up afterwards.
    undescribed = [
        entry for entry in timesheet.entries.select_related("project") if not entry.description
    ]
    if undescribed:
        first = undescribed[0]
        raise BusinessRuleViolation(
            f"Add a task description for every entry before submitting - "
            f"{first.project.code} on {first.work_date} has none "
            f"({len(undescribed)} missing in total)."
        )

    timesheet.status = ApprovalStatus.PENDING
    timesheet.submitted_at = timezone.now()
    timesheet.comments = comment or timesheet.comments
    timesheet.decision_comment = ""
    timesheet.save(
        update_fields=[
            "status",
            "submitted_at",
            "comments",
            "decision_comment",
            "total_hours",
            "updated_at",
        ]
    )
    TimesheetApproval.objects.create(
        timesheet=timesheet, actor=actor, action=TimesheetApproval.Action.SUBMITTED, comment=comment
    )

    approver = approver_for(timesheet.employee)
    notify(
        approver,
        title=f"Timesheet from {timesheet.employee.full_name}",
        message=(
            f"{timesheet.employee.full_name} submitted {timesheet.total_hours} hours for the "
            f"week of {human_date(timesheet.week_start_date)}."
        ),
        kind=Notification.Kind.TIMESHEET_SUBMITTED,
        link="/timesheets/approvals",
    )
    return timesheet


@transaction.atomic
def approve_timesheet(timesheet_id: int, actor, comment: str = "") -> Timesheet:
    timesheet = (
        Timesheet.objects.select_for_update().select_related("employee__user").get(pk=timesheet_id)
    )
    if timesheet.status != ApprovalStatus.PENDING:
        raise WorkflowStateError(
            f"Only submitted timesheets can be approved; this one is "
            f"{timesheet.get_status_display().lower()}."
        )

    timesheet.status = ApprovalStatus.APPROVED
    timesheet.decided_by = actor
    timesheet.decided_at = timezone.now()
    timesheet.decision_comment = comment
    timesheet.save(
        update_fields=["status", "decided_by", "decided_at", "decision_comment", "updated_at"]
    )
    TimesheetApproval.objects.create(
        timesheet=timesheet, actor=actor, action=TimesheetApproval.Action.APPROVED, comment=comment
    )

    notify(
        timesheet.employee.user,
        title="Timesheet approved",
        message=(
            f"Your timesheet for the week of {human_date(timesheet.week_start_date)} "
            f"({timesheet.total_hours} hours) was approved."
        ),
        kind=Notification.Kind.TIMESHEET_APPROVED,
        level=Notification.Level.SUCCESS,
        link="/timesheets",
    )
    return timesheet


@transaction.atomic
def reject_timesheet(timesheet_id: int, actor, comment: str = "") -> Timesheet:
    """Sends the sheet back to the employee, editable again."""
    timesheet = (
        Timesheet.objects.select_for_update().select_related("employee__user").get(pk=timesheet_id)
    )
    if timesheet.status != ApprovalStatus.PENDING:
        raise WorkflowStateError(
            f"Only submitted timesheets can be rejected; this one is "
            f"{timesheet.get_status_display().lower()}."
        )
    if not comment:
        raise BusinessRuleViolation("A rejection must explain what needs correcting.")

    timesheet.status = ApprovalStatus.REJECTED
    timesheet.decided_by = actor
    timesheet.decided_at = timezone.now()
    timesheet.decision_comment = comment
    timesheet.save(
        update_fields=["status", "decided_by", "decided_at", "decision_comment", "updated_at"]
    )
    TimesheetApproval.objects.create(
        timesheet=timesheet, actor=actor, action=TimesheetApproval.Action.REJECTED, comment=comment
    )

    notify(
        timesheet.employee.user,
        title="Timesheet returned for correction",
        message=(
            f"Your timesheet for the week of {human_date(timesheet.week_start_date)} was "
            f"rejected.\n\nReason: {comment}"
        ),
        kind=Notification.Kind.TIMESHEET_REJECTED,
        level=Notification.Level.WARNING,
        link="/timesheets",
    )
    return timesheet


# ---------------------------------------------------------------------------
# Submission tracking (HR)
# ---------------------------------------------------------------------------
SUBMITTED_STATES = {ApprovalStatus.PENDING, ApprovalStatus.APPROVED}


def _sheets_for_week(week_monday: date) -> dict[int, Timesheet]:
    """One query for the whole week, keyed by employee - avoids an N+1 per row."""
    return {
        sheet.employee_id: sheet for sheet in Timesheet.objects.filter(week_start_date=week_monday)
    }


def _status_row(employee: Employee, sheet: Timesheet | None) -> dict:
    status = sheet.status if sheet else None
    return {
        "employee_id": employee.pk,
        "employee_code": employee.employee_code,
        "employee_name": employee.full_name,
        "email": employee.email,
        "department_name": employee.department.name if employee.department_id else None,
        "designation_name": employee.designation.name if employee.designation_id else None,
        "timesheet_id": sheet.pk if sheet else None,
        "status": status,
        "total_hours": sheet.total_hours if sheet else None,
        # "Submitted" means it left the employee's hands - pending or approved.
        "submitted": status in SUBMITTED_STATES,
    }


def submission_status_by_employee(week_monday: date) -> list[dict]:
    """Every active employee and whether they submitted that week."""
    sheets = _sheets_for_week(week_monday)
    employees = (
        Employee.objects.filter(employment_status=EmploymentStatus.ACTIVE)
        .select_related("user", "department", "designation")
        .order_by("employee_code")
    )
    return [_status_row(employee, sheets.get(employee.pk)) for employee in employees]


def submission_status_by_project(week_monday: date) -> list[dict]:
    """Each open project, its current team, and their submission status."""
    from apps.projects.models import Project

    sheets = _sheets_for_week(week_monday)
    projects = (
        Project.objects.exclude(status=Project.Status.CANCELLED)
        .prefetch_related(
            "members__employee__user",
            "members__employee__department",
            "members__employee__designation",
        )
        .select_related("project_manager__user")
        .order_by("code")
    )

    rows = []
    for project in projects:
        members = [
            member.employee
            for member in project.members.all()
            if member.left_on is None
            and member.employee.employment_status == EmploymentStatus.ACTIVE
        ]
        employees = [_status_row(employee, sheets.get(employee.pk)) for employee in members]
        rows.append(
            {
                "project_id": project.pk,
                "project_code": project.code,
                "project_name": project.name,
                "client_name": project.client_name,
                "project_manager_name": (
                    project.project_manager.full_name if project.project_manager_id else None
                ),
                "team_size": len(employees),
                "submitted_count": sum(1 for row in employees if row["submitted"]),
                "pending_count": sum(1 for row in employees if not row["submitted"]),
                "employees": employees,
            }
        )
    return rows


@transaction.atomic
def notify_missing_timesheets(week_monday: date, employee_ids: list[int], actor) -> list[str]:
    """Nudges the employees who have not submitted. Returns who was notified.

    Anyone already submitted is skipped silently - the caller may pass a whole
    project's team without having to filter it first.
    """
    sheets = _sheets_for_week(week_monday)
    employees = Employee.objects.filter(
        pk__in=employee_ids, employment_status=EmploymentStatus.ACTIVE
    ).select_related("user")

    week_end = week_monday + timedelta(days=6)
    notified = []
    for employee in employees:
        sheet = sheets.get(employee.pk)
        if sheet and sheet.status in SUBMITTED_STATES:
            continue

        notify(
            employee.user,
            title=f"Timesheet due for {human_range(week_monday, week_end)}",
            message=(
                f"Your timesheet for the week of {human_date(week_monday)} has not been "
                "submitted. "
                "Please complete and submit it."
            ),
            kind=Notification.Kind.TIMESHEET_SUBMITTED,
            level=Notification.Level.WARNING,
            link="/timesheets",
        )
        notified.append(employee.employee_code)

    logger.info(
        "%s nudged %d employee(s) about the week of %s",
        getattr(actor, "email", "system"),
        len(notified),
        week_monday,
    )
    return notified
