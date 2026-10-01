"""Leave Management admin registrations."""

from django.contrib import admin

from apps.leave_management.models import (
    Holiday,
    LeaveApproval,
    LeaveBalance,
    LeaveRequest,
    LeaveType,
)


@admin.register(LeaveType)
class LeaveTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "days_per_year", "is_paid", "requires_approval", "is_active")
    list_filter = ("is_paid", "is_active")
    search_fields = ("code", "name")


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ("date", "name", "is_optional")
    list_filter = ("is_optional",)


@admin.register(LeaveBalance)
class LeaveBalanceAdmin(admin.ModelAdmin):
    list_display = (
        "employee",
        "leave_type",
        "year",
        "allocated_days",
        "used_days",
        "pending_days",
    )
    list_filter = ("year", "leave_type")
    search_fields = ("employee__employee_code",)
    autocomplete_fields = ("employee",)


class LeaveApprovalInline(admin.TabularInline):
    model = LeaveApproval
    extra = 0
    readonly_fields = ("actor", "action", "comment", "created_at")


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = (
        "employee",
        "leave_type",
        "start_date",
        "end_date",
        "total_days",
        "status",
    )
    list_filter = ("status", "leave_type", "start_date")
    search_fields = ("employee__employee_code",)
    autocomplete_fields = ("employee",)
    inlines = (LeaveApprovalInline,)
