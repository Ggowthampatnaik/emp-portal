"""Timesheet Management API views."""

from datetime import date, datetime, timedelta

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.timesheets.models import Timesheet
from apps.timesheets.serializers import (
    NotifyMissingSerializer,
    ProjectSubmissionSerializer,
    SubmissionStatusSerializer,
    TimesheetDecisionSerializer,
    TimesheetListSerializer,
    TimesheetSaveSerializer,
    TimesheetSerializer,
)
from apps.timesheets.services import (
    approve_timesheet,
    get_or_create_timesheet,
    last_completed_week,
    notify_missing_timesheets,
    reject_timesheet,
    save_entries,
    submission_status_by_employee,
    submission_status_by_project,
    submit_timesheet,
    week_start,
)
from common.audit import record_audit
from common.enums import ApprovalStatus, AuditAction
from common.scoping import approvable_employee_ids, employee_profile, scope_by_employee


class TimesheetViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Timesheets, their weekly grid and the approval workflow.

    Sheets are created implicitly by ``GET /timesheets/weekly/?date=YYYY-MM-DD``,
    so the employee never has to "start" a week manually.
    """

    permission_classes = [IsAuthenticated]
    filterset_fields = ("status", "employee", "week_start_date")
    ordering_fields = ("week_start_date", "total_hours", "status")
    ordering = ("-week_start_date",)

    def get_serializer_class(self):
        if self.action in ("list", "pending_approvals"):
            return TimesheetListSerializer
        if self.action in ("approve", "reject", "submit"):
            return TimesheetDecisionSerializer
        return TimesheetSerializer

    def get_queryset(self):
        queryset = Timesheet.objects.select_related(
            "employee__user", "employee__department", "decided_by"
        ).prefetch_related("entries__project", "approvals__actor")
        return scope_by_employee(queryset, self.request.user)

    # -- the weekly grid ---------------------------------------------------
    @extend_schema(
        parameters=[
            OpenApiParameter(
                "date",
                str,
                description="Any date in the wanted week; defaults to today.",
            )
        ],
        responses={200: TimesheetSerializer},
    )
    @action(detail=False, methods=["get"], url_path="weekly")
    def weekly(self, request: Request) -> Response:
        """The caller's sheet for a week, created on first access."""
        profile = employee_profile(request.user)
        if profile is None:
            raise PermissionDenied(
                "Your employee profile is not set up yet, so timesheets are unavailable."
            )

        raw = request.query_params.get("date")
        try:
            any_day = datetime.strptime(raw, "%Y-%m-%d").date() if raw else date.today()
        except ValueError:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "date must be in YYYY-MM-DD format.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        timesheet = get_or_create_timesheet(profile, any_day)
        return Response(TimesheetSerializer(timesheet).data)

    @extend_schema(request=TimesheetSaveSerializer, responses={200: TimesheetSerializer})
    @action(detail=True, methods=["put"], url_path="entries")
    def entries(self, request: Request, pk: str | None = None) -> Response:
        """Replaces the week's entries. Only the owner may edit their sheet."""
        timesheet = self.get_object()
        profile = employee_profile(request.user)
        if profile is None or timesheet.employee_id != profile.pk:
            raise PermissionDenied("You may only edit your own timesheet.")

        serializer = TimesheetSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        updated = save_entries(timesheet, serializer.validated_data["entries"])
        record_audit(
            request,
            AuditAction.UPDATE,
            updated,
            changes={
                "total_hours": str(updated.total_hours),
                "entries": len(serializer.validated_data["entries"]),
            },
        )
        return Response(TimesheetSerializer(updated).data)

    # -- transitions -------------------------------------------------------
    @extend_schema(request=TimesheetDecisionSerializer, responses={200: TimesheetSerializer})
    @action(detail=True, methods=["post"])
    def submit(self, request: Request, pk: str | None = None) -> Response:
        timesheet = self.get_object()
        profile = employee_profile(request.user)
        if profile is None or timesheet.employee_id != profile.pk:
            raise PermissionDenied("You may only submit your own timesheet.")
        if not request.user.has_module_permission("timesheet.submit"):
            raise PermissionDenied("You do not have permission to submit timesheets.")

        serializer = TimesheetDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        before = timesheet.status
        updated = submit_timesheet(timesheet.pk, request.user, serializer.validated_data["comment"])
        record_audit(
            request, AuditAction.SUBMIT, updated, changes={"status": [before, updated.status]}
        )
        return Response(TimesheetSerializer(updated).data)

    def _decide(self, request: Request, transition, audit_action: str) -> Response:
        timesheet = self.get_object()
        if not request.user.has_module_permission("timesheet.approve"):
            raise PermissionDenied("You do not have permission to decide on timesheets.")

        profile = employee_profile(request.user)
        if profile is not None and timesheet.employee_id == profile.pk:
            raise PermissionDenied("You cannot decide on your own timesheet.")
        allowed = approvable_employee_ids(request.user)
        if allowed is not None and timesheet.employee_id not in allowed:
            raise PermissionDenied("This timesheet is not in your approval queue.")

        serializer = TimesheetDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        before = timesheet.status
        updated = transition(timesheet.pk, request.user, serializer.validated_data["comment"])
        record_audit(
            request,
            audit_action,
            updated,
            changes={
                "status": [before, updated.status],
                "comment": serializer.validated_data["comment"],
            },
        )
        return Response(TimesheetSerializer(updated).data)

    @extend_schema(request=TimesheetDecisionSerializer, responses={200: TimesheetSerializer})
    @action(detail=True, methods=["post"])
    def approve(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, approve_timesheet, AuditAction.APPROVE)

    @extend_schema(request=TimesheetDecisionSerializer, responses={200: TimesheetSerializer})
    @action(detail=True, methods=["post"])
    def reject(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, reject_timesheet, AuditAction.REJECT)

    # -- queues ------------------------------------------------------------
    @extend_schema(responses={200: TimesheetListSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="me")
    def mine(self, request: Request) -> Response:
        profile = employee_profile(request.user)
        if profile is None:
            return Response([])
        rows = (
            Timesheet.objects.filter(employee=profile)
            .select_related("employee__user", "employee__department", "decided_by")
            .order_by("-week_start_date")
        )
        page = self.paginate_queryset(rows)
        serializer = TimesheetListSerializer(page if page is not None else rows, many=True)
        return (
            self.get_paginated_response(serializer.data)
            if page is not None
            else Response(serializer.data)
        )

    @extend_schema(responses={200: TimesheetListSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="pending-approvals")
    def pending_approvals(self, request: Request) -> Response:
        if not request.user.has_module_permission("timesheet.approve"):
            raise PermissionDenied("You do not have permission to approve timesheets.")

        allowed = approvable_employee_ids(request.user)
        queryset = Timesheet.objects.filter(status=ApprovalStatus.PENDING).select_related(
            "employee__user", "employee__department"
        )
        if allowed is not None:
            queryset = queryset.filter(employee_id__in=allowed)

        profile = employee_profile(request.user)
        if profile is not None:
            queryset = queryset.exclude(employee_id=profile.pk)

        queryset = queryset.order_by("week_start_date")
        page = self.paginate_queryset(queryset)
        serializer = TimesheetListSerializer(page if page is not None else queryset, many=True)
        return (
            self.get_paginated_response(serializer.data)
            if page is not None
            else Response(serializer.data)
        )

    # -- HR submission tracking -------------------------------------------
    def _requested_week(self, request: Request) -> date:
        """The week under review: the one asked for, else the last completed one."""
        raw = request.query_params.get("week")
        if raw:
            try:
                return week_start(datetime.strptime(raw, "%Y-%m-%d").date())
            except ValueError as exc:
                raise ValidationError({"week": ["Use YYYY-MM-DD."]}) from exc
        return last_completed_week()

    def _require_view_all(self, request: Request) -> None:
        if not request.user.has_module_permission("timesheet.view_all"):
            raise PermissionDenied("You do not have permission to review timesheet submissions.")

    @extend_schema(
        parameters=[OpenApiParameter("week", str, description="Any date in the wanted week.")],
        responses={200: ProjectSubmissionSerializer(many=True)},
        description="Every open project, its team, and who has submitted for the week.",
    )
    @action(detail=False, methods=["get"], url_path="status/by-project")
    def status_by_project(self, request: Request) -> Response:
        self._require_view_all(request)
        week = self._requested_week(request)
        return Response(
            {
                "week_start_date": week,
                "week_end_date": week + timedelta(days=6),
                "results": submission_status_by_project(week),
            }
        )

    @extend_schema(
        parameters=[
            OpenApiParameter("week", str, description="Any date in the wanted week."),
            OpenApiParameter(
                "counts_only",
                bool,
                description="Return the totals without the per-employee rows.",
            ),
        ],
        responses={200: SubmissionStatusSerializer(many=True)},
        description="Every active employee and whether they submitted for the week.",
    )
    @action(detail=False, methods=["get"], url_path="status/by-employee")
    def status_by_employee(self, request: Request) -> Response:
        self._require_view_all(request)
        week = self._requested_week(request)
        rows = submission_status_by_employee(week)
        payload = {
            "week_start_date": week,
            "week_end_date": week + timedelta(days=6),
            "submitted_count": sum(1 for row in rows if row["submitted"]),
            "pending_count": sum(1 for row in rows if not row["submitted"]),
        }
        # The tab badge wants one integer, not a row per employee. The work is
        # the same either way - the saving is the payload, which at five
        # hundred staff is the difference between a number and a page of JSON.
        if request.query_params.get("counts_only") == "true":
            return Response(payload)
        return Response({**payload, "results": rows})

    @extend_schema(request=NotifyMissingSerializer, responses={200: None})
    @action(detail=False, methods=["post"], url_path="notify")
    def notify(self, request: Request) -> Response:
        """Nudges whoever has not submitted - by employee, or a whole project."""
        if not request.user.has_module_permission("timesheet.notify"):
            raise PermissionDenied("You do not have permission to send timesheet reminders.")

        serializer = NotifyMissingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        week = week_start(data["week"]) if data.get("week") else last_completed_week()

        employee_ids = list(data.get("employee_ids") or [])
        if data.get("project"):
            from apps.projects.models import ProjectMember

            employee_ids += list(
                ProjectMember.objects.filter(
                    project_id=data["project"], left_on__isnull=True
                ).values_list("employee_id", flat=True)
            )

        notified = notify_missing_timesheets(week, employee_ids, request.user)
        record_audit(
            request,
            AuditAction.UPDATE,
            None,
            entity_type="TimesheetReminder",
            changes={"week": str(week), "notified": notified},
        )
        return Response({"week_start_date": week, "notified": notified, "count": len(notified)})

    @extend_schema(responses={200: TimesheetSerializer})
    @action(detail=False, methods=["get"], url_path="current-week-summary")
    def current_week_summary(self, request: Request) -> Response:
        """Small payload for the dashboard card."""
        profile = employee_profile(request.user)
        if profile is None:
            return Response({"hours": "0", "status": None, "week_start_date": None})

        monday = week_start(date.today())
        timesheet = Timesheet.objects.filter(employee=profile, week_start_date=monday).first()
        return Response(
            {
                "hours": str(timesheet.total_hours) if timesheet else "0",
                "status": timesheet.status if timesheet else ApprovalStatus.DRAFT,
                "week_start_date": monday,
                "timesheet_id": timesheet.pk if timesheet else None,
            }
        )
