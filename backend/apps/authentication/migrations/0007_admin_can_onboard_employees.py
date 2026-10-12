"""Lets the Admin role onboard employees (`employee.create`).

`seed_rbac` grants it on a fresh database. This carries the same grant to a
database that already exists - the live one, a restored dump - without
re-running the seeder, which resets every role's permissions wholesale and
would undo any edits made to roles from Administration.

Adds the one permission to the one role and touches nothing else. Does nothing
on a database that has neither yet (a brand-new install, where `seed_rbac`
does it).
"""

from django.db import migrations

ROLE = "admin"
CODE = "employee.create"


def grant(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    ModulePermission = apps.get_model("authentication", "ModulePermission")
    role = Role.objects.filter(slug=ROLE).first()
    permission = ModulePermission.objects.filter(code=CODE).first()
    if role and permission:
        role.permissions.add(permission)


def revoke(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    ModulePermission = apps.get_model("authentication", "ModulePermission")
    role = Role.objects.filter(slug=ROLE).first()
    permission = ModulePermission.objects.filter(code=CODE).first()
    if role and permission:
        role.permissions.remove(permission)


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0006_login_lockout"),
    ]

    operations = [
        migrations.RunPython(grant, revoke),
    ]
