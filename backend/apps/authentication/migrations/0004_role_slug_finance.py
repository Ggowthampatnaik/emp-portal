"""Adds the Finance role to the choices on `Role.slug`.

Choices-only: no data changes and no column change, since `slug` was already a
CharField. `seed_rbac` creates the row itself.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('authentication', '0003_alter_modulepermission_module'),
    ]

    operations = [
        migrations.AlterField(
            model_name='role',
            name='slug',
            field=models.CharField(choices=[('super_admin', 'Super Admin'), ('admin', 'Admin'), ('hr', 'HR'), ('manager', 'Manager'), ('finance', 'Finance'), ('employee', 'Employee')], max_length=50, unique=True),
        ),
    ]
