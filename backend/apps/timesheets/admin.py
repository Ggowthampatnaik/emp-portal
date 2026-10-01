"""Timesheet Management admin registrations."""

from django.contrib import admin

from apps.timesheets.models import Timesheet, TimesheetApproval, TimesheetEntry


class TimesheetEntryInline(admin.TabularInline):
    model = TimesheetEntry
    extra = 0
    autocomplete_fields = ("project",)


class TimesheetApprovalInline(admin.TabularInline):
    model = TimesheetApproval
    extra = 0
    readonly_fields = ("actor", "action", "comment", "created_at")


@admin.register(Timesheet)
class TimesheetAdmin(admin.ModelAdmin):
    list_display = ("employee", "week_start_date", "status", "total_hours", "submitted_at")
    list_filter = ("status", "week_start_date")
    search_fields = ("employee__employee_code",)
    autocomplete_fields = ("employee",)
    inlines = (TimesheetEntryInline, TimesheetApprovalInline)
