"""Reports & Analytics.

Read-only aggregates, each scoped by the same visibility rule as the underlying
records, so a manager's report covers their branch and HR's covers the company.
Every report can be returned as CSV with ``?export=csv``.
"""

import csv
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.employees.models import Department, Employee
from apps.leave_management.models import LeaveRequest
from apps.projects.models import Project, ProjectAllocation
from apps.reports.serializers import (
    BirthdayCalendarSerializer,
    DashboardSummarySerializer,
    ReportResponseSerializer,
)
from apps.reports.upcoming import (
    DASHBOARD_BIRTHDAY_LIMIT,
    DASHBOARD_HOLIDAY_LIMIT,
    NOTICEBOARD_HORIZON_DAYS,
    clamp_horizon,
    upcoming_birthdays,
    upcoming_holidays,
)
from apps.timesheets.models import Timesheet, TimesheetEntry
from common.audit import record_audit
from common.enums import (
    LEAVE_PENDING_STATES,
    ApprovalStatus,
    AuditAction,
    EmploymentStatus,
    LeaveStatus,
)
from common.scoping import scope_by_employee, scope_employees
from common.spreadsheet import safe_row


def _hours(value) -> str:
    """Renders an hours total at a fixed scale, whatever the backend returns."""
    return str(Decimal(value or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _csv_response(filename: str, columns: list[str], rows: list[dict]) -> HttpResponse:
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    writer = csv.DictWriter(response, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    # Employee, project and department names are typed by people and this
    # file is opened in a spreadsheet: a cell starting with = + - @ would run
    # as a formula. Every value goes through the same guard.
    writer.writerows(safe_row(row) for row in rows)
    return response


class BaseReportView(APIView):
    """Shared plumbing: permission gate, CSV switch, audit on export.

    Export is requested with ``?export=csv`` - ``format`` is reserved by DRF's
    content negotiation and would 404 on an unknown value.
    """

    permission_classes = [IsAuthenticated]
    permission_code = ""
    filename = "report.csv"
    columns: list[str] = []
    throttle_scope = "reports"

    def check_report_permission(self, request: Request) -> None:
        if self.permission_code and not request.user.has_module_permission(self.permission_code):
            raise PermissionDenied(f"This report requires the '{self.permission_code}' permission.")

    def respond(self, request: Request, rows: list[dict], extra: dict | None = None) -> Response:
        if request.query_params.get("export") == "csv":
            if not request.user.has_module_permission("report.export"):
                raise PermissionDenied("You do not have permission to export reports.")
            record_audit(
                request,
                AuditAction.EXPORT,
                None,
                entity_type=self.__class__.__name__,
                changes={"rows": len(rows)},
            )
            return _csv_response(self.filename, self.columns or list(rows[0] if rows else []), rows)
        return Response({"results": rows, **(extra or {})})


class EmployeeReportView(BaseReportView):
    """Headcount by department, designation and status."""

    permission_code = "report.employee"
    filename = "employee-report.csv"
    columns = ["department", "headcount", "active", "on_notice", "inactive", "managers"]

    @extend_schema(
        description="Headcount breakdown by department.",
        responses={200: ReportResponseSerializer},
    )
    def get(self, request: Request) -> Response:
        self.check_report_permission(request)
        visible = scope_employees(Employee.objects.all(), request.user)
        visible_ids = list(visible.values_list("pk", flat=True))

        rows = []
        for department in Department.objects.filter(is_active=True).order_by("name"):
            # Every count is distinct: the managers annotation joins
            # direct_reports, which would otherwise multiply the employee rows
            # and inflate the headcount for any manager with reports.
            counts = Employee.objects.filter(pk__in=visible_ids, department=department).aggregate(
                headcount=Count("pk", distinct=True),
                active=Count(
                    "pk", filter=Q(employment_status=EmploymentStatus.ACTIVE), distinct=True
                ),
                on_notice=Count(
                    "pk", filter=Q(employment_status=EmploymentStatus.ON_NOTICE), distinct=True
                ),
                inactive=Count(
                    "pk", filter=Q(employment_status=EmploymentStatus.INACTIVE), distinct=True
                ),
                # People in this department who have someone reporting to
                # them. Counting `direct_reports__pk` instead counted the
                # reports, which is a different number entirely - and a larger
                # one than the department's own headcount whenever anyone
                # manages people outside it.
                managers=Count("pk", filter=Q(direct_reports__isnull=False), distinct=True),
            )
            if counts["headcount"]:
                rows.append({"department": department.name, **counts})

        unassigned = Employee.objects.filter(pk__in=visible_ids, department__isnull=True).count()
        if unassigned:
            rows.append(
                {
                    "department": "(no department)",
                    "headcount": unassigned,
                    "active": unassigned,
                    "on_notice": 0,
                    "inactive": 0,
                    "managers": 0,
                }
            )

        return self.respond(request, rows, {"total_headcount": len(visible_ids)})


class LeaveReportView(BaseReportView):
    """Leave taken and pending, by employee and leave type."""

    permission_code = "report.leave"
    filename = "leave-report.csv"
    columns = [
        "employee_code",
        "employee",
        "department",
        "leave_type",
        "approved_days",
        "pending_days",
        "rejected_requests",
    ]

    @extend_schema(
        parameters=[
            OpenApiParameter("from", str, description="Start date (YYYY-MM-DD)."),
            OpenApiParameter("to", str, description="End date (YYYY-MM-DD)."),
        ],
        responses={200: ReportResponseSerializer},
    )
    def get(self, request: Request) -> Response:
        self.check_report_permission(request)

        queryset = scope_by_employee(
            LeaveRequest.objects.select_related(
                "employee__user", "employee__department", "leave_type"
            ),
            request.user,
        )
        if request.query_params.get("from"):
            queryset = queryset.filter(end_date__gte=request.query_params["from"])
        if request.query_params.get("to"):
            queryset = queryset.filter(start_date__lte=request.query_params["to"])

        grouped = (
            queryset.values(
                "employee__employee_code",
                "employee__user__first_name",
                "employee__user__last_name",
                "employee__department__name",
                "leave_type__name",
            )
            .annotate(
                approved_days=Sum("total_days", filter=Q(status=LeaveStatus.APPROVED)),
                # Both stages count as pending: the days are reserved either way.
                pending_days=Sum("total_days", filter=Q(status__in=LEAVE_PENDING_STATES)),
                rejected_requests=Count("pk", filter=Q(status=LeaveStatus.REJECTED)),
            )
            .order_by("employee__employee_code", "leave_type__name")
        )

        rows = [
            {
                "employee_code": row["employee__employee_code"],
                "employee": (
                    f"{row['employee__user__first_name']} " f"{row['employee__user__last_name']}"
                ).strip(),
                "department": row["employee__department__name"] or "",
                "leave_type": row["leave_type__name"],
                "approved_days": str(row["approved_days"] or Decimal("0")),
                "pending_days": str(row["pending_days"] or Decimal("0")),
                "rejected_requests": row["rejected_requests"],
            }
            for row in grouped
        ]
        return self.respond(request, rows)


class TimesheetReportView(BaseReportView):
    """Hours booked per employee and per project."""

    permission_code = "report.timesheet"
    filename = "timesheet-report.csv"
    columns = ["employee_code", "employee", "project_code", "project", "hours", "billable_hours"]

    @extend_schema(
        parameters=[
            OpenApiParameter("from", str, description="Start work date (YYYY-MM-DD)."),
            OpenApiParameter("to", str, description="End work date (YYYY-MM-DD)."),
        ],
        responses={200: ReportResponseSerializer},
    )
    def get(self, request: Request) -> Response:
        self.check_report_permission(request)

        entries = TimesheetEntry.objects.select_related("timesheet__employee__user", "project")
        entries = scope_by_employee(entries, request.user, field="timesheet__employee")

        start = request.query_params.get("from")
        end = request.query_params.get("to")
        if not start and not end:
            start = (date.today() - timedelta(days=30)).isoformat()
        if start:
            entries = entries.filter(work_date__gte=start)
        if end:
            entries = entries.filter(work_date__lte=end)

        grouped = (
            entries.values(
                "timesheet__employee__employee_code",
                "timesheet__employee__user__first_name",
                "timesheet__employee__user__last_name",
                "project__code",
                "project__name",
            )
            .annotate(
                booked_hours=Sum("hours"),
                billable=Sum("hours", filter=Q(is_billable=True)),
            )
            .order_by("timesheet__employee__employee_code", "project__code")
        )

        rows = [
            {
                "employee_code": row["timesheet__employee__employee_code"],
                "employee": (
                    f"{row['timesheet__employee__user__first_name']} "
                    f"{row['timesheet__employee__user__last_name']}"
                ).strip(),
                "project_code": row["project__code"],
                "project": row["project__name"],
                "hours": _hours(row["booked_hours"]),
                "billable_hours": _hours(row["billable"]),
            }
            for row in grouped
        ]
        total = sum((Decimal(row["hours"]) for row in rows), Decimal("0"))
        return self.respond(request, rows, {"total_hours": _hours(total), "from": start, "to": end})


class ProjectReportView(BaseReportView):
    """Per-project team size, allocation and hours booked."""

    permission_code = "report.project"
    filename = "project-report.csv"
    columns = [
        "code",
        "name",
        "client",
        "status",
        "team_size",
        "total_allocation",
        "hours_booked",
    ]

    @extend_schema(
        description="Portfolio summary with allocation and booked hours.",
        responses={200: ReportResponseSerializer},
    )
    def get(self, request: Request) -> Response:
        self.check_report_permission(request)

        projects = (
            Project.objects.annotate(
                team_size=Count("members", filter=Q(members__left_on__isnull=True), distinct=True),
                hours_booked=Sum("timesheet_entries__hours"),
            )
            .select_related("project_manager__user")
            .order_by("code")
        )

        allocation_by_project = {
            row["project_id"]: row["total"]
            for row in ProjectAllocation.objects.filter(is_active=True)
            .values("project_id")
            .annotate(total=Sum("allocation_percentage"))
        }

        rows = [
            {
                "code": project.code,
                "name": project.name,
                "client": project.client_name,
                "status": project.get_status_display(),
                "team_size": project.team_size,
                "total_allocation": str(allocation_by_project.get(project.pk, Decimal("0"))),
                "hours_booked": _hours(project.hours_booked),
            }
            for project in projects
        ]
        return self.respond(request, rows)


class BirthdayCalendarView(APIView):
    """The whole year of company birthdays, behind the dashboard card.

    The same standing as the holiday calendar the other card links to:
    company-wide, identical for every role, plain authentication. A 365-day
    window reaches every recorded birthday exactly once, and the client
    groups the result into months.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        description="Every active employee's birthday over the next year, soonest first.",
        responses={200: BirthdayCalendarSerializer},
    )
    def get(self, request: Request) -> Response:
        rows = upcoming_birthdays(
            request,
            horizon_days=365,
            limit=Employee.objects.count() + 1,
        )
        return Response({"count": len(rows), "results": rows})


class DashboardSummaryView(APIView):
    """Role-aware numbers for the dashboard cards - one request, no N+1."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        description="Counts and totals tailored to the caller's role.",
        responses={200: DashboardSummarySerializer},
    )
    def get(self, request: Request) -> Response:
        user = request.user
        profile = getattr(user, "employee_profile", None)
        today = date.today()
        monday = today - timedelta(days=today.weekday())

        horizon = clamp_horizon(request.query_params.get("horizon_days"))

        # Company-wide, and identical for every role: the noticeboard part of
        # the dashboard.
        summary: dict = {
            "as_of": today,
            "horizon_days": horizon,
            # Both cards roll forward the same number of days and are capped at
            # the same number of rows, so the pair reads as one noticeboard
            # rather than two lists that happen to sit next to each other. The
            # Holidays page behind "View More" carries the whole year.
            #
            # A rolling window rather than "the rest of this calendar month":
            # that scoping emptied both cards on the 30th and 31st, so the
            # dashboard went blank once a month by construction. The headings
            # say "next 30 days" to match.
            "upcoming_birthdays": upcoming_birthdays(
                request,
                limit=DASHBOARD_BIRTHDAY_LIMIT,
                horizon_days=NOTICEBOARD_HORIZON_DAYS,
            ),
            "upcoming_holidays": upcoming_holidays(
                limit=DASHBOARD_HOLIDAY_LIMIT,
                horizon_days=NOTICEBOARD_HORIZON_DAYS,
            ),
        }

        if profile is not None:
            from apps.leave_management.models import LeaveBalance

            # Gender-restricted entitlements (182 days of maternity leave)
            # would dominate the headline number without describing anyone's
            # ordinary year - the balance keeps its own card on the Leave page
            # for those who hold it, and stays out of this total for everyone.
            balances = LeaveBalance.objects.filter(
                employee=profile, year=today.year, leave_type__restricted_to_gender=""
            )
            entitled = sum(
                (b.allocated_days + b.carried_forward_days for b in balances), Decimal("0")
            )
            used = sum((b.used_days for b in balances), Decimal("0"))
            pending = sum((b.pending_days for b in balances), Decimal("0"))

            current = Timesheet.objects.filter(employee=profile, week_start_date=monday).first()
            summary["me"] = {
                "leave_entitled": str(entitled),
                "leave_used": str(used),
                "leave_pending": str(pending),
                "leave_available": str(entitled - used - pending),
                "week_hours": str(current.total_hours if current else Decimal("0")),
                "week_status": current.status if current else ApprovalStatus.DRAFT,
                "timesheet_id": current.pk if current else None,
                "open_leave_requests": LeaveRequest.objects.filter(
                    employee=profile, status__in=LEAVE_PENDING_STATES
                ).count(),
                "active_projects": ProjectAllocation.objects.filter(
                    employee=profile, is_active=True
                ).count(),
            }

        if user.has_module_permission("leave.approve") or user.has_module_permission(
            "timesheet.approve"
        ):
            from common.scoping import approvable_employee_ids

            allowed = approvable_employee_ids(user)
            # A manager's card counts stage one; HR's counts what is on its desk.
            leave_stage = (
                LeaveStatus.PENDING_HR
                if user.has_module_permission("leave.view_all")
                else LeaveStatus.PENDING_MANAGER
            )
            leave_queue = LeaveRequest.objects.filter(status=leave_stage)
            sheet_queue = Timesheet.objects.filter(status=ApprovalStatus.PENDING)
            if allowed is not None:
                leave_queue = leave_queue.filter(employee_id__in=allowed)
                sheet_queue = sheet_queue.filter(employee_id__in=allowed)
            if profile is not None:
                leave_queue = leave_queue.exclude(employee_id=profile.pk)
                sheet_queue = sheet_queue.exclude(employee_id=profile.pk)

            summary["approvals"] = {
                "pending_leave": leave_queue.count(),
                "pending_timesheets": sheet_queue.count(),
                "team_size": len(allowed) if allowed is not None else Employee.objects.count(),
            }

        if user.is_privileged:
            summary["organization"] = {
                "headcount": Employee.objects.filter(
                    employment_status=EmploymentStatus.ACTIVE
                ).count(),
                "departments": Department.objects.filter(is_active=True).count(),
                "active_projects": Project.objects.filter(status=Project.Status.ACTIVE).count(),
                "on_leave_today": LeaveRequest.objects.filter(
                    status=LeaveStatus.APPROVED, start_date__lte=today, end_date__gte=today
                ).count(),
            }

        return Response(summary)
