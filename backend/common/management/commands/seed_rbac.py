"""Seeds the role hierarchy and permission catalogue.

Idempotent - safe to run on every deploy (the CI/CD release step calls it after
``migrate``). Role capabilities mirror section 4 of the architecture document.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.authentication.models import ModulePermission, Role
from common.enums import RoleSlug

# (code, module, name)
PERMISSIONS: list[tuple[str, str, str]] = [
    ("employee.view_self", "employees", "View own profile"),
    ("employee.edit_self", "employees", "Edit own profile"),
    ("employee.view_team", "employees", "View team members"),
    ("employee.view_all", "employees", "View all employees"),
    ("employee.create", "employees", "Create employees"),
    ("employee.edit", "employees", "Edit employees"),
    ("employee.deactivate", "employees", "Deactivate employees"),
    ("employee.request_deletion", "employees", "Request account closure"),
    ("employee.approve_deletion", "employees", "Approve or decline account closure"),
    ("department.manage", "employees", "Manage departments and designations"),
    ("bank.view_self", "employees", "View own bank details"),
    ("bank.manage", "employees", "Maintain employee bank details"),
    ("asset.manage", "employees", "Issue and maintain company assets"),
    ("skill.manage", "employees", "Manage the skill vocabulary"),
    ("project.view", "projects", "View projects"),
    ("project.view_all", "projects", "View all projects"),
    ("project.manage", "projects", "Create and edit projects"),
    ("project.assign_team", "projects", "Assign project teams"),
    ("project.allocate", "projects", "Manage project allocations"),
    ("leave.apply", "leave", "Apply for leave"),
    ("leave.view_self", "leave", "View own leave"),
    ("leave.view_team", "leave", "View team leave"),
    ("leave.view_all", "leave", "View all leave"),
    ("leave.approve", "leave", "Approve or reject leave"),
    ("leave.cancel_any", "leave", "Cancel any leave request"),
    ("leave.manage_policy", "leave", "Manage leave types, balances and holidays"),
    ("timesheet.submit", "timesheets", "Submit timesheets"),
    ("timesheet.view_self", "timesheets", "View own timesheets"),
    ("timesheet.view_team", "timesheets", "View team timesheets"),
    ("timesheet.view_all", "timesheets", "View all timesheets"),
    ("timesheet.approve", "timesheets", "Approve or reject timesheets"),
    ("timesheet.notify", "timesheets", "Send timesheet submission reminders"),
    ("payroll.view_self", "payroll", "View own payslips"),
    ("payroll.view_all", "payroll", "View all payslips"),
    ("payroll.manage", "payroll", "Manage salary structures"),
    ("payroll.process", "payroll", "Open and process payroll runs"),
    ("payroll.approve", "payroll", "Approve and release payroll"),
    ("payroll.push_to_finance", "payroll", "Send payslips to Finance"),
    ("finance.view", "finance", "See the Finance module"),
    ("finance.approve", "finance", "Release payslips for payment"),
    ("report.employee", "reports", "Employee reports"),
    ("report.leave", "reports", "Leave reports"),
    ("report.timesheet", "reports", "Timesheet reports"),
    ("report.project", "reports", "Project reports"),
    ("report.export", "reports", "Export reports"),
    ("admin.manage_users", "administration", "Manage users"),
    ("admin.manage_roles", "administration", "Manage roles and permissions"),
    ("admin.system_config", "administration", "System configuration"),
    ("admin.view_audit_log", "administration", "View audit logs"),
]

EMPLOYEE_PERMISSIONS = [
    "employee.view_self",
    "employee.edit_self",
    "bank.view_self",
    "project.view",
    "leave.apply",
    "leave.view_self",
    "timesheet.submit",
    "timesheet.view_self",
    "payroll.view_self",
]

MANAGER_PERMISSIONS = [
    *EMPLOYEE_PERMISSIONS,
    "employee.view_team",
    "project.view_all",
    "project.assign_team",
    "project.allocate",
    "leave.view_team",
    "leave.approve",
    "timesheet.view_team",
    "timesheet.approve",
    "report.leave",
    "report.timesheet",
    "report.project",
    "report.export",
]

HR_PERMISSIONS = [
    *EMPLOYEE_PERMISSIONS,
    "employee.view_all",
    "employee.create",
    "employee.edit",
    "employee.deactivate",
    "employee.request_deletion",
    "department.manage",
    "bank.manage",
    "asset.manage",
    "skill.manage",
    # Read-only across the company. HR staffs nobody and allocates nothing -
    # that stays with the reporting manager - but "who is on what" is an HR
    # question, and without this the Projects page is empty for them: they sit
    # on no team, so the scoped query returns nothing at all.
    "project.view_all",
    "leave.view_all",
    "leave.approve",
    "leave.cancel_any",
    "leave.manage_policy",
    "timesheet.view_all",
    "timesheet.notify",
    "report.employee",
    "report.leave",
    "report.timesheet",
    "report.export",
    "payroll.view_all",
    "payroll.manage",
    "payroll.process",
    "payroll.push_to_finance",
]

ADMIN_PERMISSIONS = [
    *EMPLOYEE_PERMISSIONS,
    "employee.view_all",
    "employee.edit",
    "employee.approve_deletion",
    "department.manage",
    "asset.manage",
    "project.view_all",
    "project.manage",
    "leave.view_all",
    "timesheet.view_all",
    "report.employee",
    "report.leave",
    "report.timesheet",
    "report.project",
    "report.export",
    "admin.manage_users",
    "admin.manage_roles",
    "admin.system_config",
    "admin.view_audit_log",
    "payroll.view_all",
    "payroll.approve",
]

# Finance releases pay. Beyond its own module it gets only the self-service
# every employee has - a Finance user is somebody's colleague too - so it sees
# other people's *pay* and nobody else's record, leave or timesheets.
FINANCE_PERMISSIONS = [
    *EMPLOYEE_PERMISSIONS,
    "finance.view",
    "finance.approve",
    "payroll.view_all",
]


ROLES: dict[str, tuple[str, str, list[str]]] = {
    RoleSlug.SUPER_ADMIN.value: (
        "Super Admin",
        "Full access to all modules and system settings.",
        [code for code, _, _ in PERMISSIONS],
    ),
    RoleSlug.ADMIN.value: (
        "Admin",
        "Manages users, roles, permissions, projects, configuration and system reports.",
        ADMIN_PERMISSIONS,
    ),
    RoleSlug.HR.value: (
        "HR",
        "Manages employees, leave policies, holidays and organization reports.",
        HR_PERMISSIONS,
    ),
    RoleSlug.MANAGER.value: (
        "Manager",
        "Approves leave and timesheets, manages the team, assigns projects, views reports.",
        MANAGER_PERMISSIONS,
    ),
    RoleSlug.FINANCE.value: (
        "Finance",
        "Releases payslips for payment. Sees pay figures and nothing else.",
        FINANCE_PERMISSIONS,
    ),
    RoleSlug.EMPLOYEE.value: (
        "Employee",
        "Manages own profile, applies for leave, submits timesheets, views projects.",
        EMPLOYEE_PERMISSIONS,
    ),
}


class Command(BaseCommand):
    help = "Create/refresh the portal roles and their permission grants."

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        permissions: dict[str, ModulePermission] = {}
        for code, module, name in PERMISSIONS:
            permission, _ = ModulePermission.objects.update_or_create(
                code=code, defaults={"module": module, "name": name}
            )
            permissions[code] = permission

        for slug, (name, description, codes) in ROLES.items():
            role, created = Role.objects.update_or_create(
                slug=slug,
                defaults={"name": name, "description": description, "is_system": True},
            )
            role.permissions.set([permissions[code] for code in dict.fromkeys(codes)])
            verb = "Created" if created else "Updated"
            self.stdout.write(f"{verb} role {name} ({len(set(codes))} permissions)")

        self.stdout.write(
            self.style.SUCCESS(f"RBAC seeded: {len(PERMISSIONS)} permissions, {len(ROLES)} roles.")
        )
