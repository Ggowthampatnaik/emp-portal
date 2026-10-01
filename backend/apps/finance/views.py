"""Finance API: the payslip release queue."""

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.finance.models import PayslipApproval
from apps.finance.serializers import (
    FinanceDecisionSerializer,
    FinanceQuerySerializer,
    PayslipApprovalListSerializer,
    PayslipApprovalSerializer,
)
from apps.finance.services import query_payslip, release_payslip
from common.audit import record_audit
from common.enums import AuditAction
from common.permissions import HasModulePermission


class PayslipApprovalViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Payslips HR has pushed to Finance, and Finance's decision on each.

    Finance sees pay figures and nothing else about an employee: this module
    deliberately carries no route into the employee record, the leave history
    or the timesheets.
    """

    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("finance.view",)
    filterset_fields = ("status", "payslip__run", "payslip__employee")
    ordering = ("-processed_at",)

    def get_serializer_class(self):
        if self.action == "list":
            return PayslipApprovalListSerializer
        if self.action == "query":
            return FinanceQuerySerializer
        if self.action == "approve":
            return FinanceDecisionSerializer
        return PayslipApprovalSerializer

    def get_queryset(self):
        return PayslipApproval.objects.select_related(
            "payslip__run",
            "payslip__employee__user",
            "payslip__employee__department",
            "payslip__employee__designation",
            "processed_by",
            "approved_by",
        )

    def _decide(self, request: Request, transition, audit_action: str) -> Response:
        approval = self.get_object()
        # `finance.view` opens the queue; deciding needs `finance.approve`, so a
        # read-only Finance account can watch without being able to release money.
        if not request.user.has_module_permission("finance.approve"):
            raise PermissionDenied("You may see the Finance queue but not decide on it.")

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        before = approval.status
        updated = transition(approval.pk, request.user, serializer.validated_data["comment"])
        record_audit(
            request,
            audit_action,
            updated,
            changes={
                "employee": updated.payslip.employee.employee_code,
                "period": updated.payslip.run.period_label,
                "status": [before, updated.status],
                "comment": updated.comment,
            },
        )
        return Response(PayslipApprovalSerializer(updated).data)

    @extend_schema(
        request=FinanceDecisionSerializer,
        responses={200: PayslipApprovalSerializer},
        description="Release the payslip for payment. Amounts are never changed here.",
    )
    @action(detail=True, methods=["post"])
    def approve(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, release_payslip, AuditAction.APPROVE)

    @extend_schema(
        request=FinanceQuerySerializer,
        responses={200: PayslipApprovalSerializer},
        description=(
            "Send the payslip back to HR with a question. Finance has no reject: "
            "a query keeps the conversation going rather than dead-ending it."
        ),
    )
    @action(detail=True, methods=["post"])
    def query(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, query_payslip, AuditAction.REJECT)
