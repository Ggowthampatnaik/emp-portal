"""Timesheet Management serializers."""

from decimal import Decimal

from rest_framework import serializers

from apps.projects.models import Project
from apps.timesheets.models import Timesheet, TimesheetApproval, TimesheetEntry


class TimesheetEntrySerializer(serializers.ModelSerializer):
    project_code = serializers.CharField(source="project.code", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = TimesheetEntry
        fields = (
            "id",
            "project",
            "project_code",
            "project_name",
            "work_date",
            "hours",
            "description",
            "is_billable",
        )


class TimesheetEntryWriteSerializer(serializers.Serializer):
    """One cell of the weekly grid."""

    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    work_date = serializers.DateField()
    hours = serializers.DecimalField(max_digits=4, decimal_places=2, min_value=Decimal("0"))
    description = serializers.CharField(
        required=False, allow_blank=True, max_length=500, default=""
    )
    is_billable = serializers.BooleanField(required=False, default=True)


class TimesheetSaveSerializer(serializers.Serializer):
    """Full-week save: the grid posts every cell it is showing."""

    entries = TimesheetEntryWriteSerializer(many=True)


class TimesheetApprovalSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True, default=None)

    class Meta:
        model = TimesheetApproval
        fields = ("id", "action", "comment", "actor_name", "created_at")


class TimesheetSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(
        source="employee.department.name", read_only=True, default=None
    )
    week_end_date = serializers.DateField(read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    decided_by_name = serializers.CharField(
        source="decided_by.full_name", read_only=True, default=None
    )
    entries = TimesheetEntrySerializer(many=True, read_only=True)
    approvals = TimesheetApprovalSerializer(many=True, read_only=True)

    class Meta:
        model = Timesheet
        fields = (
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "department_name",
            "week_start_date",
            "week_end_date",
            "status",
            "total_hours",
            "comments",
            "is_editable",
            "submitted_at",
            "decided_by_name",
            "decided_at",
            "decision_comment",
            "entries",
            "approvals",
        )
        read_only_fields = fields


class TimesheetListSerializer(serializers.ModelSerializer):
    """Lighter shape for lists and approval queues."""

    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(
        source="employee.department.name", read_only=True, default=None
    )
    week_end_date = serializers.DateField(read_only=True)

    class Meta:
        model = Timesheet
        fields = (
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "department_name",
            "week_start_date",
            "week_end_date",
            "status",
            "total_hours",
            "submitted_at",
            "decided_at",
            "decision_comment",
        )
        read_only_fields = fields


class TimesheetDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class SubmissionStatusSerializer(serializers.Serializer):
    """One employee's submission state for a given week."""

    employee_id = serializers.IntegerField()
    employee_code = serializers.CharField()
    employee_name = serializers.CharField()
    email = serializers.EmailField()
    department_name = serializers.CharField(allow_null=True)
    designation_name = serializers.CharField(allow_null=True)
    timesheet_id = serializers.IntegerField(allow_null=True)
    status = serializers.CharField(allow_null=True)
    total_hours = serializers.DecimalField(max_digits=6, decimal_places=2, allow_null=True)
    submitted = serializers.BooleanField()


class ProjectSubmissionSerializer(serializers.Serializer):
    project_id = serializers.IntegerField()
    project_code = serializers.CharField()
    project_name = serializers.CharField()
    client_name = serializers.CharField(allow_blank=True)
    project_manager_name = serializers.CharField(allow_null=True)
    team_size = serializers.IntegerField()
    submitted_count = serializers.IntegerField()
    pending_count = serializers.IntegerField()
    employees = SubmissionStatusSerializer(many=True)


class NotifyMissingSerializer(serializers.Serializer):
    """Nudge specific employees, or everyone on a project."""

    employee_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    project = serializers.IntegerField(required=False)
    week = serializers.DateField(required=False)

    def validate(self, attrs: dict) -> dict:
        if not attrs.get("employee_ids") and not attrs.get("project"):
            raise serializers.ValidationError(
                {"employee_ids": ["Give either a list of employees or a project."]}
            )
        return attrs
