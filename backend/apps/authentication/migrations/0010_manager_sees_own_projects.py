"""Takes the whole portfolio (`project.view_all`) away from the Manager role.

A manager now sees the projects they manage or are on. `seed_rbac` leaves it off
on a fresh database; as in 0008, this touches only that one permission on that
one role, so any other edits made to roles from Administration survive.
"""

from django.db import migrations

ROLE = "manager"
CODE = "project.view_all"


def revoke(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    ModulePermission = apps.get_model("authentication", "ModulePermission")
    role = Role.objects.filter(slug=ROLE).first()
    permission = ModulePermission.objects.filter(code=CODE).first()
    if role and permission:
        role.permissions.remove(permission)


def restore(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    ModulePermission = apps.get_model("authentication", "ModulePermission")
    role = Role.objects.filter(slug=ROLE).first()
    permission = ModulePermission.objects.filter(code=CODE).first()
    if role and permission:
        role.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0009_finance_led_payroll"),
    ]

    operations = [
        migrations.RunPython(revoke, restore),
    ]
