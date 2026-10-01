"""Project Management admin registrations."""

from django.contrib import admin

from apps.projects.models import Project, ProjectAllocation, ProjectMember


class ProjectMemberInline(admin.TabularInline):
    model = ProjectMember
    extra = 0
    autocomplete_fields = ("employee",)


class ProjectAllocationInline(admin.TabularInline):
    model = ProjectAllocation
    extra = 0
    autocomplete_fields = ("employee",)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "client_name", "status", "start_date", "project_manager")
    list_filter = ("status", "is_billable", "department")
    search_fields = ("code", "name", "client_name")
    autocomplete_fields = ("project_manager", "department")
    inlines = (ProjectMemberInline, ProjectAllocationInline)
