"""Leave Management serializers."""

from rest_framework import serializers

from apps.leave_management.models import (
    Holiday,
    LeaveApproval,
    LeaveBalance,
    LeaveRequest,
    LeaveRequestCC,
    LeaveType,
)
from apps.leave_management.services import count_leave_days


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = (
            "id",
            "code",
            "name",
            "description",
            "days_per_year",
            "is_paid",
            "requires_approval",
            "max_consecutive_days",
            "allow_half_day",
            "carry_forward",
            "is_active",
            "restricted_to_gender",
        )


class HolidaySerializer(serializers.ModelSerializer):
    day_of_week = serializers.SerializerMethodField()
    # Required here rather than on the model. Holidays already on file predate
    # the rule and several carry no description; making the column non-blank
    # would either invent text for them or make them uneditable. This governs
    # what can be written, which is what was asked - and an old holiday picks
    # up a description the next time somebody saves it.
    description = serializers.CharField(
        allow_blank=False,
        error_messages={
            "blank": "Say what this holiday is for - employees see it wherever it appears.",
            "required": "Say what this holiday is for - employees see it wherever it appears.",
        },
    )

    class Meta:
        model = Holiday
        fields = ("id", "date", "name", "description", "is_optional", "day_of_week")

    def get_day_of_week(self, obj: Holiday) -> str:
        return obj.date.strftime("%A")


class LeaveBalanceSerializer(serializers.ModelSerializer):
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    leave_type_code = serializers.CharField(source="leave_type.code", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    entitled_days = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)
    available_days = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)

    class Meta:
        model = LeaveBalance
        fields = (
            "id",
            "employee",
            "employee_name",
            "leave_type",
            "leave_type_code",
            "leave_type_name",
            "year",
            "allocated_days",
            "carried_forward_days",
            "entitled_days",
            "used_days",
            "pending_days",
            "available_days",
        )
        read_only_fields = ("used_days", "pending_days")


class LeaveApprovalSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True, default=None)

    class Meta:
        model = LeaveApproval
        fields = ("id", "action", "comment", "actor_name", "created_at")


class LeaveRequestCCSerializer(serializers.ModelSerializer):
    """Who was copied in, and whether they were actually told."""

    user_name = serializers.CharField(source="user.full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    employee_code = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequestCC
        fields = ("id", "user", "user_name", "email", "employee_code", "notified_at")
        read_only_fields = fields

    def get_employee_code(self, obj: LeaveRequestCC) -> str | None:
        profile = getattr(obj.user, "employee_profile", None)
        return profile.employee_code if profile else None


class LeaveRequestSerializer(serializers.ModelSerializer):
    """Read shape for lists and detail."""

    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(
        source="employee.department.name", read_only=True, default=None
    )
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    decided_by_name = serializers.CharField(
        source="decided_by.full_name", read_only=True, default=None
    )
    approvals = LeaveApprovalSerializer(many=True, read_only=True)
    cc_recipients = LeaveRequestCCSerializer(many=True, read_only=True)
    can_cancel = serializers.SerializerMethodField()
    manager_decided_by_name = serializers.CharField(
        source="manager_decided_by.full_name", read_only=True, default=None
    )
    hr_decided_by_name = serializers.CharField(
        source="hr_decided_by.full_name", read_only=True, default=None
    )
    stage = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = (
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "department_name",
            "leave_type",
            "leave_type_name",
            "start_date",
            "end_date",
            "day_part",
            "total_days",
            "reason",
            "contact_number",
            "status",
            "applied_at",
            "decided_by_name",
            "decided_at",
            "decision_comment",
            "manager_status",
            "manager_decided_by_name",
            "manager_decided_at",
            "manager_comment",
            "hr_status",
            "hr_decided_by_name",
            "hr_decided_at",
            "hr_comment",
            "stage",
            "approvals",
            "cc_recipients",
            "can_cancel",
        )
        read_only_fields = fields

    def get_stage(self, obj: LeaveRequest) -> str:
        """Which desk the request is sitting on, for the timeline display."""
        from common.enums import LeaveStatus

        if obj.status == LeaveStatus.PENDING_MANAGER:
            return "manager"
        if obj.status == LeaveStatus.PENDING_HR:
            return "hr"
        return "closed"

    def get_can_cancel(self, obj: LeaveRequest) -> bool:
        from django.utils import timezone

        from common.enums import LeaveStatus

        if obj.is_pending:
            return True
        return obj.status == LeaveStatus.APPROVED and obj.start_date > timezone.localdate()


class LeaveRequestCreateSerializer(serializers.Serializer):
    """Write shape for applying. The day count is computed, never submitted."""

    leave_type = serializers.PrimaryKeyRelatedField(
        queryset=LeaveType.objects.filter(is_active=True)
    )
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    day_part = serializers.ChoiceField(
        choices=LeaveRequest.DayPart.choices, default=LeaveRequest.DayPart.FULL
    )
    reason = serializers.CharField(min_length=5, max_length=1000)
    contact_number = serializers.CharField(required=False, allow_blank=True, max_length=20)
    # Informational only - being copied in grants no access to the request.
    cc_user_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list, max_length=10
    )

    def validate(self, attrs: dict) -> dict:
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError(
                {"end_date": ["The end date cannot precede the start date."]}
            )
        attrs["preview_days"] = count_leave_days(
            attrs["start_date"], attrs["end_date"], attrs["day_part"]
        )
        return attrs


class LeaveDecisionSerializer(serializers.Serializer):
    """Approve / reject / cancel payload."""

    comment = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class LeaveQueueSerializer(LeaveRequestSerializer):
    """A queue row, with the applicant's remaining balance for that leave type.

    HR asked for this: approving without knowing what is left is how a balance
    goes negative. Annotated by the view, so the extra columns cost one query
    for the page rather than one per row.
    """

    available_days = serializers.SerializerMethodField()
    entitled_days = serializers.SerializerMethodField()
    used_days = serializers.SerializerMethodField()

    class Meta(LeaveRequestSerializer.Meta):
        fields = (
            *LeaveRequestSerializer.Meta.fields,
            "available_days",
            "entitled_days",
            "used_days",
        )
        read_only_fields = fields

    def _balance(self, obj: LeaveRequest):
        return (self.context.get("balances") or {}).get((obj.employee_id, obj.leave_type_id))

    def get_available_days(self, obj: LeaveRequest) -> str | None:
        balance = self._balance(obj)
        return str(balance.available_days) if balance else None

    def get_entitled_days(self, obj: LeaveRequest) -> str | None:
        balance = self._balance(obj)
        return str(balance.entitled_days) if balance else None

    def get_used_days(self, obj: LeaveRequest) -> str | None:
        balance = self._balance(obj)
        return str(balance.used_days) if balance else None


class LeaveSendBackSerializer(serializers.Serializer):
    """HR returning a request to the manager. The reason is not optional (D2)."""

    comment = serializers.CharField(min_length=5, max_length=1000)
