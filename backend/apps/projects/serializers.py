"""Project Management serializers."""

from decimal import Decimal

from rest_framework import serializers

from apps.projects.models import Project, ProjectAllocation, ProjectMember


class ProjectMemberSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    designation = serializers.CharField(
        source="employee.designation.name", read_only=True, default=None
    )
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = ProjectMember
        fields = (
            "id",
            "project",
            "employee",
            "employee_code",
            "employee_name",
            "designation",
            "role_in_project",
            "joined_on",
            "left_on",
            "is_active",
        )

    def validate(self, attrs: dict) -> dict:
        project = attrs.get("project") or getattr(self.instance, "project", None)
        employee = attrs.get("employee") or getattr(self.instance, "employee", None)
        joined_on = attrs.get("joined_on") or getattr(self.instance, "joined_on", None)
        left_on = attrs.get("left_on", getattr(self.instance, "left_on", None))

        if left_on and joined_on and left_on < joined_on:
            raise serializers.ValidationError(
                {"left_on": ["The leaving date cannot precede the joining date."]}
            )

        if project and employee and left_on is None:
            clash = ProjectMember.objects.filter(
                project=project, employee=employee, left_on__isnull=True
            )
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {"employee": ["This employee is already an active member of the project."]}
                )
        return attrs


class ProjectAllocationSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = ProjectAllocation
        fields = (
            "id",
            "project",
            "project_code",
            "project_name",
            "employee",
            "employee_code",
            "employee_name",
            "allocation_percentage",
            "start_date",
            "end_date",
            "is_active",
        )

    def validate(self, attrs: dict) -> dict:
        employee = attrs.get("employee") or getattr(self.instance, "employee", None)
        percentage = attrs.get(
            "allocation_percentage", getattr(self.instance, "allocation_percentage", None)
        )
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        start_date = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))

        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError(
                {"end_date": ["The end date cannot precede the start date."]}
            )

        if employee and percentage and is_active:
            existing = ProjectAllocation.employee_total(
                employee.pk, exclude_pk=self.instance.pk if self.instance else None
            )
            if existing + Decimal(percentage) > Decimal("100"):
                available = Decimal("100") - existing
                raise serializers.ValidationError(
                    {
                        "allocation_percentage": [
                            f"{employee.full_name} is already allocated {existing}%. "
                            f"At most {available}% is available."
                        ]
                    }
                )
        return attrs


class ProjectListSerializer(serializers.ModelSerializer):
    project_manager_name = serializers.CharField(
        source="project_manager.full_name", read_only=True, default=None
    )
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    member_count = serializers.IntegerField(read_only=True)
    total_allocation = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = (
            "id",
            "code",
            "name",
            "client_name",
            "department",
            "department_name",
            "project_manager",
            "project_manager_name",
            "status",
            "start_date",
            "end_date",
            "is_billable",
            "member_count",
            "total_allocation",
        )

    def get_total_allocation(self, obj: Project) -> str:
        return str(obj.total_allocation())


class ProjectDetailSerializer(ProjectListSerializer):
    members = ProjectMemberSerializer(many=True, read_only=True)
    allocations = ProjectAllocationSerializer(many=True, read_only=True)

    class Meta(ProjectListSerializer.Meta):
        fields = (
            *ProjectListSerializer.Meta.fields,
            "description",
            "members",
            "allocations",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs: dict) -> dict:
        start_date = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError(
                {"end_date": ["The end date cannot precede the start date."]}
            )
        return attrs
