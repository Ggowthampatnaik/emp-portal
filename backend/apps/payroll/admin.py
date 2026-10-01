"""Payroll admin registrations (maintenance only; the portal is the real UI)."""

from django.contrib import admin

from apps.payroll.models import PayrollRun, Payslip, SalaryStructure


@admin.register(SalaryStructure)
class SalaryStructureAdmin(admin.ModelAdmin):
    list_display = ("employee", "effective_from", "effective_to", "gross_monthly", "net_monthly")
    list_filter = ("effective_from",)
    search_fields = ("employee__employee_code", "employee__user__email")
    autocomplete_fields = ("employee",)


class PayslipInline(admin.TabularInline):
    model = Payslip
    extra = 0
    readonly_fields = ("employee", "gross_earnings", "total_deductions", "net_pay")
    can_delete = False


@admin.register(PayrollRun)
class PayrollRunAdmin(admin.ModelAdmin):
    list_display = ("period_label", "status", "employee_count", "total_net", "processed_at")
    list_filter = ("status", "year")
    inlines = (PayslipInline,)


@admin.register(Payslip)
class PayslipAdmin(admin.ModelAdmin):
    list_display = ("employee", "run", "paid_days", "gross_earnings", "net_pay")
    list_filter = ("run__year", "run__month")
    search_fields = ("employee__employee_code",)
    autocomplete_fields = ("employee",)
