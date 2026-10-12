"""Takes onboarding (`employee.create`) away from the HR role.

Onboarding now belongs to Admin alone (Administration -> Users, granted in
0007). `seed_rbac` leaves it off HR on a fresh database; this removes it from a
database that already exists, touching only that one permission on that one
role, so any other edits made to roles from Administration survive.
"""

from django.db import migrations

ROLE = "hr"
CODE = "employee.create"


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
        ("authentication", "0007_admin_can_onboard_employees"),
    ]

    operations = [
        migrations.RunPython(revoke, restore),
    ]
