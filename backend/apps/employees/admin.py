"""Employee Management admin registrations."""

from django.contrib import admin

from apps.employees.models import (
    Department,
    Designation,
    Employee,
    EmployeeAsset,
    EmployeeDocument,
)


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "head", "is_active")
    search_fields = ("code", "name")


@admin.register(Designation)
class DesignationAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "level", "is_active")
    search_fields = ("code", "name")


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = (
        "employee_code",
        "full_name",
        "department",
        "designation",
        "reporting_manager",
        "employment_status",
    )
    list_filter = ("employment_status", "department", "designation")
    search_fields = ("employee_code", "user__email", "user__first_name", "user__last_name")
    autocomplete_fields = ("user", "department", "designation", "reporting_manager")


@admin.register(EmployeeDocument)
class EmployeeDocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "employee", "document_type", "created_at")
    list_filter = ("document_type",)


@admin.register(EmployeeAsset)
class EmployeeAssetAdmin(admin.ModelAdmin):
    list_display = ("serial_number", "name", "brand", "employee")
    list_filter = ("brand",)
    search_fields = ("serial_number", "name", "brand", "employee__employee_code")
