"""Finance serializers."""

from rest_framework import serializers

from apps.finance.models import PayslipApproval
from apps.payroll.serializers import PayslipSerializer


class PayslipApprovalSerializer(serializers.ModelSerializer):
    """A payslip awaiting release, with enough of it to judge without a second call."""

    payslip_detail = PayslipSerializer(source="payslip", read_only=True)
    employee_name = serializers.CharField(source="payslip.employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="payslip.employee.employee_code", read_only=True)
    department_name = serializers.CharField(
        source="payslip.employee.department.name", read_only=True, default=None
    )
    period_label = serializers.CharField(source="payslip.run.period_label", read_only=True)
    net_pay = serializers.DecimalField(
        source="payslip.net_pay", max_digits=12, decimal_places=2, read_only=True
    )
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    processed_by_name = serializers.CharField(
        source="processed_by.full_name", read_only=True, default=None
    )
    approved_by_name = serializers.CharField(
        source="approved_by.full_name", read_only=True, default=None
    )
    awaits_finance = serializers.BooleanField(read_only=True)
    #: True when the person who sent this to Finance is also the person being
    #: paid by it. Not forbidden - HR is one person here, and somebody has to
    #: push their own payslip - but the releaser is the independent check on
    #: that, so the queue says so rather than leaving them to notice.
    self_processed = serializers.SerializerMethodField()

    def get_self_processed(self, obj) -> bool:
        processed_by_id = obj.processed_by_id
        employee_user_id = obj.payslip.employee.user_id
        return bool(processed_by_id and processed_by_id == employee_user_id)

    class Meta:
        model = PayslipApproval
        fields = (
            "id",
            "payslip",
            "payslip_detail",
            "employee_name",
            "employee_code",
            "department_name",
            "period_label",
            "net_pay",
            "status",
            "status_label",
            "awaits_finance",
            "self_processed",
            "processed_by_name",
            "processed_at",
            "approved_by_name",
            "approved_at",
            "comment",
        )
        read_only_fields = fields


class PayslipApprovalListSerializer(PayslipApprovalSerializer):
    """The queue: the same row without the full payslip breakdown."""

    class Meta(PayslipApprovalSerializer.Meta):
        fields = tuple(
            field for field in PayslipApprovalSerializer.Meta.fields if field != "payslip_detail"
        )
        read_only_fields = fields


class FinanceDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class FinanceQuerySerializer(serializers.Serializer):
    """Raising a query. The comment is the whole point of it, so it is required."""

    comment = serializers.CharField(min_length=5, max_length=1000)
