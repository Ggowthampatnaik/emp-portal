"""Payroll serializers."""

from rest_framework import serializers

from apps.payroll.models import PayrollRun, Payslip, SalaryStructure


class SalaryStructureSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(
        source="employee.department.name", read_only=True, default=None
    )
    gross_monthly = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    deductions_monthly = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    net_monthly = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    annual_ctc = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = SalaryStructure
        fields = (
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "department_name",
            "effective_from",
            "effective_to",
            "basic",
            "hra",
            "conveyance_allowance",
            "medical_allowance",
            "special_allowance",
            "provident_fund",
            "professional_tax",
            "income_tax",
            "other_deductions",
            "gross_monthly",
            "deductions_monthly",
            "net_monthly",
            "annual_ctc",
            "is_current",
            "notes",
            "created_at",
        )
        read_only_fields = ("effective_to", "created_at")
        # DRF derives a UniqueTogetherValidator from the model constraint,
        # which fires first and reports "must make a unique set" against
        # non_field_errors. validate() below says the same thing against the
        # field the user actually typed in.
        validators: list = []

    def validate(self, attrs: dict) -> dict:
        employee = attrs.get("employee") or getattr(self.instance, "employee", None)
        effective_from = attrs.get("effective_from") or getattr(
            self.instance, "effective_from", None
        )

        if employee and effective_from:
            clash = SalaryStructure.objects.filter(employee=employee, effective_from=effective_from)
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {
                        "effective_from": [
                            "This employee already has a salary structure starting on that date."
                        ]
                    }
                )

        merged = {**(self.instance.__dict__ if self.instance else {}), **attrs}
        earnings = sum(
            merged.get(field) or 0
            for field in (
                "basic",
                "hra",
                "conveyance_allowance",
                "medical_allowance",
                "special_allowance",
            )
        )
        deductions = sum(
            merged.get(field) or 0
            for field in (
                "provident_fund",
                "professional_tax",
                "income_tax",
                "other_deductions",
            )
        )
        if earnings <= 0:
            raise serializers.ValidationError(
                {"basic": ["Total monthly earnings must be above zero."]}
            )
        if deductions > earnings:
            raise serializers.ValidationError(
                {"other_deductions": ["Deductions cannot exceed monthly earnings."]}
            )
        return attrs


class PayslipSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(
        source="employee.department.name", read_only=True, default=None
    )
    designation_name = serializers.CharField(
        source="employee.designation.name", read_only=True, default=None
    )
    period_label = serializers.CharField(read_only=True)
    year = serializers.IntegerField(source="run.year", read_only=True)
    month = serializers.IntegerField(source="run.month", read_only=True)
    run_status = serializers.CharField(source="run.status", read_only=True)

    class Meta:
        model = Payslip
        fields = (
            "id",
            "run",
            "run_status",
            "period_label",
            "year",
            "month",
            "employee",
            "employee_code",
            "employee_name",
            "department_name",
            "designation_name",
            "working_days",
            "lop_days",
            "paid_days",
            "basic",
            "hra",
            "conveyance_allowance",
            "medical_allowance",
            "special_allowance",
            "provident_fund",
            "professional_tax",
            "income_tax",
            "other_deductions",
            "lop_amount",
            "gross_earnings",
            "total_deductions",
            "net_pay",
            "created_at",
        )
        read_only_fields = fields


class PayrollRunSerializer(serializers.ModelSerializer):
    period_label = serializers.CharField(read_only=True)
    month_name = serializers.CharField(source="get_month_display", read_only=True)
    processed_by_name = serializers.CharField(
        source="processed_by.full_name", read_only=True, default=None
    )
    approved_by_name = serializers.CharField(
        source="approved_by.full_name", read_only=True, default=None
    )
    is_locked = serializers.BooleanField(read_only=True)
    is_editable = serializers.BooleanField(read_only=True)

    class Meta:
        model = PayrollRun
        fields = (
            "id",
            "year",
            "month",
            "month_name",
            "period_label",
            "status",
            "notes",
            "working_days",
            "employee_count",
            "total_gross",
            "total_deductions",
            "total_net",
            "processed_by_name",
            "processed_at",
            "approved_by_name",
            "approved_at",
            "paid_at",
            "is_locked",
            "is_editable",
            "created_at",
        )
        read_only_fields = (
            "status",
            "working_days",
            "employee_count",
            "total_gross",
            "total_deductions",
            "total_net",
            "processed_by_name",
            "processed_at",
            "approved_by_name",
            "approved_at",
            "paid_at",
            "created_at",
        )
        # See the note on SalaryStructureSerializer: our own message points at
        # the month field rather than non_field_errors.
        validators: list = []

    def validate(self, attrs: dict) -> dict:
        year = attrs.get("year") or getattr(self.instance, "year", None)
        month = attrs.get("month") or getattr(self.instance, "month", None)

        if year and (year < 2000 or year > 2100):
            raise serializers.ValidationError({"year": ["Enter a year between 2000 and 2100."]})

        if year and month:
            clash = PayrollRun.objects.filter(year=year, month=month)
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {"month": ["A payroll run already exists for that month."]}
                )
        return attrs


class PayrollRunDetailSerializer(PayrollRunSerializer):
    payslips = PayslipSerializer(many=True, read_only=True)

    class Meta(PayrollRunSerializer.Meta):
        fields = (*PayrollRunSerializer.Meta.fields, "payslips")


class RunDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")
