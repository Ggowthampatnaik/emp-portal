"""Payroll API views."""

import csv
from datetime import date
from decimal import Decimal

from django.db.models import Q, QuerySet
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.finance.models import PayslipApproval
from apps.finance.services import release_run, send_run_back, send_run_to_finance
from apps.payroll.models import PayrollRun, Payslip, SalaryStructure
from apps.payroll.pdf import payslip_filename, render_payslip_pdf
from apps.payroll.serializers import (
    PayrollRunDetailSerializer,
    PayrollRunSerializer,
    PayslipSerializer,
    RunDecisionSerializer,
    SalaryStructureSerializer,
)
from apps.payroll.services import process_run, unapproved_timesheets
from common.audit import record_audit
from common.enums import AuditAction
from common.permissions import HasModulePermission
from common.scoping import employee_profile
from common.spreadsheet import safe_row


def released(payslips: QuerySet[Payslip]) -> QuerySet[Payslip]:
    """What an employee may see of their own pay: what Finance has released.

    A month sent to Finance can still come back to HR, so nothing is published
    on the way there.
    """
    return payslips.filter(
        Q(run__status=PayrollRun.Status.PAID)
        | Q(finance_approval__status=PayslipApproval.Status.APPROVED)
    )


class SalaryStructureViewSet(viewsets.ModelViewSet):
    """Salary structures. Only payroll administrators see or change these."""

    serializer_class = SalaryStructureSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("payroll.manage",)
    filterset_fields = ("employee",)
    # Everything on the row somebody might type. It was code and first name
    # only, so searching a surname - the obvious thing to type - found nothing.
    search_fields = (
        "employee__employee_code",
        "employee__user__first_name",
        "employee__user__last_name",
        "employee__user__email",
        "employee__department__name",
        "employee__designation__name",
    )
    ordering_fields = ("effective_from", "employee__employee_code")
    ordering = ("-effective_from",)
    queryset = SalaryStructure.objects.none()  # schema generation only

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SalaryStructure.objects.none()
        queryset = SalaryStructure.objects.select_related(
            "employee__user", "employee__department", "employee__designation"
        )
        if self.request.query_params.get("current") == "true":
            queryset = queryset.filter(effective_to__isnull=True)
        return queryset

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        self._close_previous(instance)
        record_audit(
            self.request,
            AuditAction.CREATE,
            instance,
            changes={"gross_monthly": str(instance.gross_monthly)},
        )

    def perform_update(self, serializer):
        instance = serializer.save(updated_by=self.request.user)
        record_audit(self.request, AuditAction.UPDATE, instance)

    def perform_destroy(self, instance):
        if instance.payslips.exists():
            raise PermissionDenied(
                "This structure has been used on a payslip and cannot be deleted."
            )
        record_audit(self.request, AuditAction.DELETE, instance)
        instance.delete()

    @staticmethod
    def _close_previous(instance: SalaryStructure) -> None:
        """A new structure ends the one before it, the day before it starts."""
        from datetime import timedelta

        previous = (
            SalaryStructure.objects.filter(
                employee=instance.employee, effective_from__lt=instance.effective_from
            )
            .exclude(pk=instance.pk)
            .order_by("-effective_from")
            .first()
        )
        if previous and previous.effective_to != instance.effective_from - timedelta(days=1):
            previous.effective_to = instance.effective_from - timedelta(days=1)
            previous.save(update_fields=["effective_to", "updated_at"])


class PayrollRunViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Monthly payroll runs and their workflow.

    ``payroll.process`` opens and processes a run,
    ``payroll.push_to_finance`` sends it to Finance, and ``finance.approve``
    releases it or sends it back. Whoever sent it cannot release it.
    """

    permission_classes = [IsAuthenticated, HasModulePermission]
    filterset_fields = ("year", "status")
    ordering = ("-year", "-month")
    queryset = PayrollRun.objects.none()  # schema generation only

    @property
    def required_permissions(self):
        if self.action in ("create", "destroy", "process"):
            return ("payroll.process",)
        if self.action in ("send_to_finance", "timesheet_check"):
            return ("payroll.push_to_finance",)
        if self.action in ("release", "send_back"):
            return ("finance.approve",)
        return ("payroll.view_all",)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PayrollRun.objects.none()
        queryset = PayrollRun.objects.select_related("processed_by", "sent_by", "paid_by")
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(
                "payslips__employee__user",
                "payslips__employee__department",
                "payslips__employee__designation",
                "payslips__finance_approval",
            )
        return queryset

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PayrollRunDetailSerializer
        if self.action in ("process", "send_back"):
            return RunDecisionSerializer
        return PayrollRunSerializer

    def perform_create(self, serializer):
        instance = serializer.save()
        record_audit(
            self.request, AuditAction.CREATE, instance, changes={"period": instance.period_label}
        )

    def perform_destroy(self, instance):
        if instance.is_locked:
            raise PermissionDenied(
                f"A {instance.get_status_display().lower()} run cannot be deleted."
            )
        record_audit(self.request, AuditAction.DELETE, instance)
        instance.delete()

    @extend_schema(request=RunDecisionSerializer, responses={200: PayrollRunSerializer})
    @action(detail=True, methods=["post"])
    def process(self, request: Request, pk: str | None = None) -> Response:
        """Generates every payslip for the run, replacing any earlier attempt."""
        run = self.get_object()
        before = run.status
        updated = process_run(run.pk, request.user)
        record_audit(
            request, AuditAction.SUBMIT, updated, changes={"status": [before, updated.status]}
        )
        return Response(PayrollRunSerializer(updated).data)

    @extend_schema(
        responses={200: dict},
        description="Who has a week HR has not approved, to warn before sending.",
    )
    @action(detail=True, methods=["get"], url_path="timesheet-check")
    def timesheet_check(self, request: Request, pk: str | None = None) -> Response:
        return Response({"unapproved": unapproved_timesheets(self.get_object())})

    @extend_schema(request=None, responses={200: PayrollRunSerializer})
    @action(detail=True, methods=["post"], url_path="send-to-finance")
    def send_to_finance(self, request: Request, pk: str | None = None) -> Response:
        """Asks Finance to pay the month. Unapproved timesheets do not stop it."""
        run = self.get_object()
        unapproved = len(unapproved_timesheets(run))
        before = run.status
        updated = send_run_to_finance(run.pk, request.user)
        record_audit(
            request,
            AuditAction.SUBMIT,
            updated,
            changes={
                "status": [before, updated.status],
                "employees_with_unapproved_timesheets": unapproved,
            },
        )
        return Response(PayrollRunSerializer(updated).data)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"])
    def release(self, request: Request, pk: str | None = None) -> Response:
        """Pays the month. A queried payslip is held and the rest go out."""
        run = self.get_object()
        outcome = release_run(run.pk, request.user)
        record_audit(request, AuditAction.APPROVE, run, changes=outcome)
        return Response(outcome)

    @extend_schema(request=RunDecisionSerializer, responses={200: PayrollRunSerializer})
    @action(detail=True, methods=["post"], url_path="send-back")
    def send_back(self, request: Request, pk: str | None = None) -> Response:
        run = self.get_object()
        serializer = RunDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data["comment"]

        before = run.status
        updated = send_run_back(run.pk, request.user, comment)
        record_audit(
            request,
            AuditAction.REJECT,
            updated,
            changes={"status": [before, updated.status], "comment": comment},
        )
        return Response(PayrollRunSerializer(updated).data)

    @extend_schema(description="Bank transfer sheet for an approved run, as CSV.")
    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request: Request, pk: str | None = None) -> HttpResponse:
        run = self.get_object()
        if not request.user.has_module_permission("report.export"):
            raise PermissionDenied("You do not have permission to export payroll.")

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="payroll-{run.year}-{run.month:02d}.csv"'
        )
        writer = csv.writer(response)
        writer.writerow(
            [
                "employee_code",
                "employee",
                "department",
                "paid_days",
                "lop_days",
                "gross_earnings",
                "total_deductions",
                "net_pay",
            ]
        )
        # Names and department names are typed by people and land in a
        # spreadsheet; a cell starting with = + - @ would run as a formula.
        # The amounts are numbers and pass through untouched.
        for slip in run.payslips.select_related("employee__user", "employee__department"):
            writer.writerow(
                safe_row(
                    [
                        slip.employee.employee_code,
                        slip.employee.full_name,
                        slip.employee.department.name if slip.employee.department_id else "",
                        slip.paid_days,
                        slip.lop_days,
                        slip.gross_earnings,
                        slip.total_deductions,
                        slip.net_pay,
                    ]
                )
            )
        record_audit(request, AuditAction.EXPORT, run, changes={"rows": run.payslips.count()})
        return response


class PayslipViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Payslips.

    An employee sees their own; ``payroll.view_all`` sees everyone's. Payslips
    only become visible once Finance has released them - a month on its way
    there is not something to publish.
    """

    serializer_class = PayslipSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("run", "employee", "run__year")
    ordering = ("-run__year", "-run__month")
    queryset = Payslip.objects.none()  # schema generation only

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Payslip.objects.none()

        queryset = Payslip.objects.select_related(
            "run", "employee__user", "employee__department", "employee__designation"
        )
        if self.request.user.has_module_permission("payroll.view_all"):
            return self._filter(queryset)

        profile = employee_profile(self.request.user)
        if profile is None:
            return Payslip.objects.none()

        # Everyone else sees their own, and only once Finance has released it.
        # Their own, not their branch: a manager approves leave and hours for
        # their reports, never sees their pay. `retrieve` and `pdf` already
        # refuse other people's payslips; the list has to agree with them.
        return self._filter(released(queryset.filter(employee=profile)))

    def _filter(self, queryset):
        """`?project=`, `?year=` and `?month=`, for the HR drill-down (F14).

        The project filter matches anyone *currently* on that project rather
        than who was on it during the payroll month: staffing history is not
        recorded per month, and a payslip belongs to the person, not to the
        project they happened to be on.
        """
        params = self.request.query_params

        project = params.get("project")
        if project:
            if not project.isdigit():
                raise ValidationError({"project": ["Give a project id."]})
            queryset = queryset.filter(
                employee__project_memberships__project_id=int(project),
                employee__project_memberships__left_on__isnull=True,
            ).distinct()

        for name, field in (("year", "run__year"), ("month", "run__month")):
            value = params.get(name)
            if value:
                if not value.isdigit():
                    raise ValidationError({name: ["Give a number."]})
                queryset = queryset.filter(**{field: int(value)})

        return queryset

    @extend_schema(responses={200: PayslipSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="me")
    def mine(self, request: Request) -> Response:
        """The caller's own payslips, newest first."""
        profile = employee_profile(request.user)
        if profile is None:
            return Response([])

        rows = (
            released(Payslip.objects.filter(employee=profile))
            .select_related(
                "run", "employee__user", "employee__department", "employee__designation"
            )
            .order_by("-run__year", "-run__month")
        )
        return Response(PayslipSerializer(rows, many=True).data)

    @extend_schema(responses={200: PayslipSerializer})
    @action(detail=False, methods=["get"], url_path="latest")
    def latest(self, request: Request) -> Response:
        """The most recent published payslip, for the dashboard card."""
        profile = employee_profile(request.user)
        if profile is None:
            return Response({})

        slip = (
            released(Payslip.objects.filter(employee=profile))
            .select_related("run", "employee__user")
            .order_by("-run__year", "-run__month")
            .first()
        )
        return Response(PayslipSerializer(slip).data if slip else {})

    def _assert_may_read(self, slip: Payslip) -> None:
        profile = employee_profile(self.request.user)
        is_own = profile is not None and slip.employee_id == profile.pk
        if not is_own and not self.request.user.has_module_permission("payroll.view_all"):
            raise PermissionDenied("You may only view your own payslips.")

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        slip = self.get_object()
        self._assert_may_read(slip)
        return Response(self.get_serializer(slip).data)

    @extend_schema(
        request=None,
        responses={200: PayslipSerializer},
        description=(
            "Put one payslip back in front of Finance (`payroll.push_to_finance`), "
            "usually after answering a query. The month has to have been sent."
        ),
    )
    @action(detail=True, methods=["post"], url_path="process")
    def process(self, request: Request, pk: str | None = None) -> Response:
        from apps.finance.services import process_payslip

        if not request.user.has_module_permission("payroll.push_to_finance"):
            raise PermissionDenied("You do not have permission to send payslips to Finance.")

        slip = self.get_object()
        approval = process_payslip(slip.pk, request.user)
        record_audit(
            request,
            AuditAction.SUBMIT,
            approval,
            changes={
                "employee": slip.employee.employee_code,
                "period": slip.run.period_label,
                "status": approval.status,
            },
        )
        return Response(self.get_serializer(slip).data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "employee",
                int,
                description="Whose payslips. Needs `payroll.view_all`; defaults to the caller.",
            )
        ],
        responses={200: dict},
        description=(
            "Which months have a payslip, grouped by year, newest first - the "
            "shape the year/month drill-down navigates."
        ),
    )
    @action(detail=False, methods=["get"], url_path="periods")
    def periods(self, request: Request) -> Response:
        wanted = request.query_params.get("employee")
        if wanted:
            if not request.user.has_module_permission("payroll.view_all"):
                raise PermissionDenied("You may only look at your own payslip history.")
            rows = self.get_queryset().filter(employee_id=wanted)
        else:
            profile = employee_profile(request.user)
            if profile is None:
                return Response({"years": []})
            rows = released(self.get_queryset().filter(employee=profile))

        periods: dict[int, list[dict]] = {}
        for slip in rows.order_by("-run__year", "-run__month"):
            periods.setdefault(slip.run.year, []).append(
                {
                    "month": slip.run.month,
                    "month_name": slip.run.get_month_display(),
                    "payslip_id": slip.pk,
                    "net_pay": str(slip.net_pay),
                }
            )

        return Response(
            {
                "years": [
                    {
                        "year": year,
                        "months": months,
                        "total_net": str(sum(Decimal(m["net_pay"]) for m in months)),
                    }
                    for year, months in periods.items()
                ]
            }
        )

    @extend_schema(
        responses={(200, "application/pdf"): bytes},
        description=(
            "The payslip as a PDF, named `EmployeeName_Year_Month.pdf`. Readable "
            "by the employee it belongs to, and by anyone with `payroll.view_all`."
        ),
    )
    @action(detail=False, methods=["get"], url_path=r"(?P<payslip_id>\d+)/pdf")
    def pdf(self, request: Request, payslip_id: str = "") -> HttpResponse:
        slip = (
            self.get_queryset()
            .filter(pk=payslip_id)
            .select_related("run", "employee__user", "employee__department")
            .first()
        )
        if slip is None:
            raise NotFound("No such payslip.")
        self._assert_may_read(slip)

        response = HttpResponse(render_payslip_pdf(slip), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{payslip_filename(slip)}"'
        return response


def current_period() -> tuple[int, int]:
    today = date.today()
    return today.year, today.month
