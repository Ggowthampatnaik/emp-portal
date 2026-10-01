"""Leave Management API views."""

import zipfile
from datetime import date

from django.db.models import Q
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.leave_management.models import Holiday, LeaveBalance, LeaveRequest, LeaveType
from apps.leave_management.serializers import (
    HolidaySerializer,
    LeaveBalanceSerializer,
    LeaveDecisionSerializer,
    LeaveQueueSerializer,
    LeaveRequestCreateSerializer,
    LeaveRequestSerializer,
    LeaveSendBackSerializer,
    LeaveTypeSerializer,
)
from apps.leave_management.services import (
    apply_for_leave,
    cancel_leave,
    get_or_create_balance,
    hr_approve,
    hr_send_back,
    import_holidays_docx,
    manager_approve,
    manager_reject,
)
from common.audit import record_audit
from common.enums import LEAVE_PENDING_STATES, AuditAction, LeaveStatus
from common.permissions import HasModulePermission
from common.scoping import approvable_employee_ids, employee_profile, scope_by_employee


def _balances_for(rows) -> dict[tuple[int, int], LeaveBalance]:
    """Balances for the requests on one queue page, keyed by (employee, type).

    One query for the page. Fetching per row is what makes an approval queue
    slow once a company has more than a handful of people in it.
    """
    wanted = [(row.employee_id, row.leave_type_id, row.start_date.year) for row in rows]
    if not wanted:
        return {}

    lookup = Q()
    for employee_id, leave_type_id, year in set(wanted):
        lookup |= Q(employee_id=employee_id, leave_type_id=leave_type_id, year=year)

    return {
        (balance.employee_id, balance.leave_type_id): balance
        for balance in LeaveBalance.objects.filter(lookup)
    }


class LeaveTypeViewSet(viewsets.ModelViewSet):
    """Leave policies. Everyone reads them; HR owns them."""

    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = {
        "POST": ("leave.manage_policy",),
        "PUT": ("leave.manage_policy",),
        "PATCH": ("leave.manage_policy",),
        "DELETE": ("leave.manage_policy",),
    }
    filterset_fields = ("is_active", "is_paid")
    search_fields = ("name", "code")

    def perform_create(self, serializer):
        record_audit(self.request, AuditAction.CREATE, serializer.save())

    def perform_update(self, serializer):
        record_audit(self.request, AuditAction.UPDATE, serializer.save())


#: Upload cap for the holiday calendar, and what it may inflate to.
MAX_IMPORT_BYTES = 2 * 1024 * 1024
MAX_INFLATED_BYTES = 20 * MAX_IMPORT_BYTES


class HolidayViewSet(viewsets.ModelViewSet):
    """The holiday calendar."""

    serializer_class = HolidaySerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = {
        "POST": ("leave.manage_policy",),
        "PUT": ("leave.manage_policy",),
        "PATCH": ("leave.manage_policy",),
        "DELETE": ("leave.manage_policy",),
    }
    filterset_fields = ("is_optional",)
    ordering = ("date",)

    def get_queryset(self):
        queryset = Holiday.objects.all()
        year = self.request.query_params.get("year")
        if year and year.isdigit():
            queryset = queryset.filter(date__year=int(year))
        return queryset

    def perform_create(self, serializer):
        record_audit(self.request, AuditAction.CREATE, serializer.save())

    def perform_update(self, serializer):
        record_audit(self.request, AuditAction.UPDATE, serializer.save())

    def perform_destroy(self, instance):
        record_audit(self.request, AuditAction.DELETE, instance)
        instance.delete()

    @extend_schema(
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {
                    "file": {"type": "string", "format": "binary"},
                    "year": {"type": "integer"},
                },
            }
        },
        description=(
            "Imports the holiday calendar from a Word document (.docx) - a table "
            "or a list with a date and a name per row. Creates and updates only; "
            "an import never deletes a holiday. `year` fills in for rows whose "
            "date has no year of its own (default: the current year)."
        ),
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="import-docx",
        parser_classes=[MultiPartParser, FormParser],
    )
    def import_docx(self, request: Request) -> Response:
        file = request.FILES.get("file")
        if file is None:
            raise DRFValidationError({"file": "Attach the .docx holiday calendar."})
        # A .docx is a zip, and python-docx inflates the whole of it. A
        # calendar is a few kilobytes; anything that inflates to a hundred
        # times its size is not one, and would otherwise take the worker.
        if file.size > MAX_IMPORT_BYTES:
            raise DRFValidationError(
                {"file": f"The calendar must be under {MAX_IMPORT_BYTES // (1024 * 1024)} MB."}
            )
        try:
            with zipfile.ZipFile(file) as archive:
                inflated = sum(info.file_size for info in archive.infolist())
        except zipfile.BadZipFile:
            inflated = 0  # not a zip at all; the parser says so, in the house shape
        if inflated > MAX_INFLATED_BYTES:
            raise DRFValidationError({"file": "That document is not a holiday calendar."})
        file.seek(0)

        year_raw = str(request.data.get("year") or "").strip()
        default_year = int(year_raw) if year_raw.isdigit() else date.today().year

        summary, touched = import_holidays_docx(file, default_year)
        for holiday, created in touched:
            record_audit(request, AuditAction.CREATE if created else AuditAction.UPDATE, holiday)
        return Response(summary)


class LeaveBalanceViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Balances, scoped like every other employee-owned record."""

    serializer_class = LeaveBalanceSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("year", "leave_type", "employee")
    ordering = ("-year",)

    def get_queryset(self):
        queryset = LeaveBalance.objects.select_related("leave_type", "employee__user")
        return scope_by_employee(queryset, self.request.user)

    @extend_schema(responses={200: LeaveBalanceSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request: Request) -> Response:
        """The caller's balances for the current year, opening any that are missing."""
        profile = employee_profile(request.user)
        if profile is None:
            return Response([])

        year = int(request.query_params.get("year", date.today().year))
        # A gender-restricted type (maternity leave) does not exist for anyone
        # it excludes: no balance is opened and none is listed.
        for leave_type in LeaveType.objects.filter(is_active=True):
            if leave_type.available_to(profile):
                get_or_create_balance(profile, leave_type, year)

        balances = (
            LeaveBalance.objects.filter(employee=profile, year=year)
            .filter(
                Q(leave_type__restricted_to_gender="")
                | Q(leave_type__restricted_to_gender=profile.gender)
            )
            .select_related("leave_type", "employee__user")
            .order_by("leave_type__name")
        )
        return Response(LeaveBalanceSerializer(balances, many=True).data)


@extend_schema_view(
    list=extend_schema(description="Leave requests visible to the caller."),
    create=extend_schema(
        request=LeaveRequestCreateSerializer, responses={201: LeaveRequestSerializer}
    ),
)
class LeaveRequestViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Leave requests and their workflow transitions.

    Requests are never edited in place - they are applied for, then approved,
    rejected or cancelled, each of which is recorded in ``leave_approvals``.
    """

    permission_classes = [IsAuthenticated]
    filterset_fields = ("status", "leave_type", "employee")
    search_fields = ("employee__employee_code", "reason")
    ordering_fields = ("start_date", "applied_at", "status")
    ordering = ("-start_date",)

    def get_serializer_class(self):
        if self.action == "create":
            return LeaveRequestCreateSerializer
        if self.action == "send_back":
            return LeaveSendBackSerializer
        if self.action in ("approve", "reject", "cancel"):
            return LeaveDecisionSerializer
        if self.action in ("pending_approvals", "hr_approvals"):
            return LeaveQueueSerializer
        return LeaveRequestSerializer

    def get_queryset(self):
        queryset = LeaveRequest.objects.select_related(
            "employee__user",
            "employee__department",
            "leave_type",
            "decided_by",
            "manager_decided_by",
            "hr_decided_by",
        ).prefetch_related("approvals__actor", "cc_recipients__user")

        # Date-range filter used by the calendar view.
        params = self.request.query_params
        if params.get("from"):
            queryset = queryset.filter(end_date__gte=params["from"])
        if params.get("to"):
            queryset = queryset.filter(start_date__lte=params["to"])

        return scope_by_employee(queryset, self.request.user)

    # -- apply -------------------------------------------------------------
    def create(self, request: Request, *args, **kwargs) -> Response:
        profile = employee_profile(request.user)
        if profile is None:
            raise PermissionDenied(
                "Your employee profile is not set up yet, so leave cannot be applied for."
            )
        if not request.user.has_module_permission("leave.apply"):
            raise PermissionDenied("You do not have permission to apply for leave.")

        serializer = LeaveRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        leave_request = apply_for_leave(
            employee=profile,
            leave_type=data["leave_type"],
            start=data["start_date"],
            end=data["end_date"],
            reason=data["reason"],
            day_part=data["day_part"],
            contact_number=data.get("contact_number", ""),
            cc_user_ids=data.get("cc_user_ids") or [],
        )
        record_audit(
            request,
            AuditAction.SUBMIT,
            leave_request,
            changes={
                "total_days": str(leave_request.total_days),
                "status": leave_request.status,
                "cc": [entry.user.email for entry in leave_request.cc_recipients.all()],
            },
        )
        return Response(LeaveRequestSerializer(leave_request).data, status=status.HTTP_201_CREATED)

    # -- queues ------------------------------------------------------------
    @extend_schema(responses={200: LeaveRequestSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="me")
    def mine(self, request: Request) -> Response:
        profile = employee_profile(request.user)
        if profile is None:
            return Response([])
        rows = (
            LeaveRequest.objects.filter(employee=profile)
            .select_related("leave_type", "employee__user", "decided_by")
            .prefetch_related("approvals__actor")
            .order_by("-start_date")
        )
        page = self.paginate_queryset(rows)
        serializer = LeaveRequestSerializer(page if page is not None else rows, many=True)
        return (
            self.get_paginated_response(serializer.data)
            if page is not None
            else Response(serializer.data)
        )

    def _queue(self, request: Request, status_value: str) -> Response:
        """One approval queue, scoped, never including the caller's own request."""
        if not request.user.has_module_permission("leave.approve"):
            raise PermissionDenied("You do not have permission to approve leave.")

        queryset = LeaveRequest.objects.filter(status=status_value).select_related(
            "employee__user", "employee__department", "leave_type"
        )

        allowed = approvable_employee_ids(request.user)
        if allowed is not None:
            queryset = queryset.filter(employee_id__in=allowed)

        profile = employee_profile(request.user)
        if profile is not None:
            queryset = queryset.exclude(employee_id=profile.pk)

        queryset = queryset.order_by("start_date")
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else queryset
        context = {**self.get_serializer_context(), "balances": _balances_for(rows)}
        serializer = LeaveQueueSerializer(rows, many=True, context=context)
        return (
            self.get_paginated_response(serializer.data)
            if page is not None
            else Response(serializer.data)
        )

    @extend_schema(
        responses={200: LeaveQueueSerializer(many=True)},
        description="Stage one: requests waiting on the caller as reporting manager.",
    )
    @action(detail=False, methods=["get"], url_path="pending-approvals")
    def pending_approvals(self, request: Request) -> Response:
        return self._queue(request, LeaveStatus.PENDING_MANAGER)

    @extend_schema(
        responses={200: LeaveQueueSerializer(many=True)},
        description=(
            "Stage two: requests the manager has approved and HR must confirm. "
            "Each row carries the applicant's remaining balance for that leave type."
        ),
    )
    @action(detail=False, methods=["get"], url_path="hr-approvals")
    def hr_approvals(self, request: Request) -> Response:
        if not request.user.has_module_permission("leave.view_all"):
            raise PermissionDenied("The HR approval queue is not available to you.")
        return self._queue(request, LeaveStatus.PENDING_HR)

    @extend_schema(responses={200: LeaveRequestSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="team-calendar")
    def team_calendar(self, request: Request) -> Response:
        """Approved and pending leave for the visible population, for a date range."""
        params = request.query_params
        queryset = self.get_queryset().filter(
            status__in=[LeaveStatus.APPROVED, *LEAVE_PENDING_STATES]
        )
        if not params.get("from") and not params.get("to"):
            today = date.today()
            queryset = queryset.filter(
                Q(end_date__gte=today.replace(day=1)) | Q(status__in=LEAVE_PENDING_STATES)
            )
        return Response(LeaveRequestSerializer(queryset[:500], many=True).data)

    # -- transitions -------------------------------------------------------
    def _decide(self, request: Request, pk: str, transition, audit_action: str) -> Response:
        leave_request = self.get_object()

        # Stage two is HR's alone: holding leave.approve as a manager is not
        # enough, or a manager could take a request from applied to approved by
        # themselves, which is the whole point of splitting the stages.
        is_hr_stage = transition in (hr_approve, hr_send_back)
        works_stage_two = request.user.has_module_permission("leave.view_all")
        if is_hr_stage and not works_stage_two:
            raise PermissionDenied("Only HR can act on the second stage of approval.")

        # HR does not reject leave at all - that is the business rule, not just a
        # hidden button. Disagreement goes back to the reporting manager, who
        # owns the conversation with the employee.
        if transition is manager_reject and works_stage_two:
            raise PermissionDenied(
                "HR does not reject leave. Send the request back to the reporting "
                "manager with a comment instead."
            )

        if transition is not cancel_leave:
            if not request.user.has_module_permission("leave.approve"):
                raise PermissionDenied("You do not have permission to decide on leave.")
            profile = employee_profile(request.user)
            if profile is not None and leave_request.employee_id == profile.pk:
                raise PermissionDenied("You cannot decide on your own leave request.")
            allowed = approvable_employee_ids(request.user)
            if allowed is not None and leave_request.employee_id not in allowed:
                raise PermissionDenied("This request is not in your approval queue.")
        else:
            profile = employee_profile(request.user)
            is_own = profile is not None and leave_request.employee_id == profile.pk
            if not is_own and not request.user.has_module_permission("leave.cancel_any"):
                raise PermissionDenied("You may only cancel your own leave requests.")

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data.get("comment", "")

        before = leave_request.status
        updated = transition(leave_request.pk, request.user, comment)
        record_audit(
            request,
            audit_action,
            updated,
            changes={"status": [before, updated.status], "comment": comment},
        )
        return Response(LeaveRequestSerializer(updated).data)

    @extend_schema(
        request=LeaveDecisionSerializer,
        responses={200: LeaveRequestSerializer},
        description=(
            "Approve. Which stage this clears depends on where the request is: "
            "the manager hands it to HR, HR confirms it and debits the balance."
        ),
    )
    @action(detail=True, methods=["post"])
    def approve(self, request: Request, pk: str | None = None) -> Response:
        leave_request = self.get_object()
        transition = hr_approve if leave_request.awaits_hr else manager_approve
        return self._decide(request, pk or "", transition, AuditAction.APPROVE)

    @extend_schema(
        request=LeaveDecisionSerializer,
        responses={200: LeaveRequestSerializer},
        description="Reject outright. Available at the manager stage only (decision D2).",
    )
    @action(detail=True, methods=["post"])
    def reject(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, pk or "", manager_reject, AuditAction.REJECT)

    @extend_schema(
        request=LeaveSendBackSerializer,
        responses={200: LeaveRequestSerializer},
        description=(
            "HR returns the request to the manager with a mandatory reason "
            "(decision D2). The reserved days are untouched."
        ),
    )
    @action(detail=True, methods=["post"], url_path="send-back")
    def send_back(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, pk or "", hr_send_back, AuditAction.REJECT)

    @extend_schema(request=LeaveDecisionSerializer, responses={200: LeaveRequestSerializer})
    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, pk or "", cancel_leave, AuditAction.UPDATE)

    def get_object(self):
        try:
            return super().get_object()
        except LeaveRequest.DoesNotExist as exc:  # pragma: no cover - DRF raises Http404
            raise NotFound("Leave request not found.") from exc
