"""Permissions for the HR-to-Finance payroll process.

Payroll no longer has an administrator's approval, so `payroll.approve` goes,
and HR gains the final say on timesheets with `timesheet.hr_approve`. Like 0007
this leaves every other edit made to roles from Administration alone, and does
nothing on a brand-new database, where `seed_rbac` sets the roles up.
"""

from django.db import migrations

RETIRED = "payroll.approve"
ADDED = "timesheet.hr_approve"
ADDED_TO = ("hr", "super_admin")


def forward(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    ModulePermission = apps.get_model("authentication", "ModulePermission")

    ModulePermission.objects.filter(code=RETIRED).delete()

    roles = Role.objects.filter(slug__in=ADDED_TO)
    if not roles.exists():
        return
    permission, _ = ModulePermission.objects.get_or_create(
        code=ADDED,
        defaults={"module": "timesheets", "name": "Give HR's final approval on timesheets"},
    )
    for role in roles:
        role.permissions.add(permission)


def backward(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    ModulePermission = apps.get_model("authentication", "ModulePermission")

    ModulePermission.objects.filter(code=ADDED).delete()

    roles = Role.objects.filter(slug__in=("admin", "super_admin"))
    if not roles.exists():
        return
    permission, _ = ModulePermission.objects.get_or_create(
        code=RETIRED,
        defaults={"module": "payroll", "name": "Approve and release payroll"},
    )
    for role in roles:
        role.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0008_hr_no_longer_onboards"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
