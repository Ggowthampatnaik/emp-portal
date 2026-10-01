"""Splits the single ``address`` field into permanent and temporary addresses.

The auto-generated migration dropped ``address`` before the new columns
existed, which would have discarded every recorded address. The order here is
add -> copy -> remove, and the reverse migration copies back, so the change is
safe in both directions.
"""

from django.db import migrations, models


def copy_address_forward(apps, schema_editor):
    """Existing addresses are the address of record, so they become permanent."""
    Employee = apps.get_model("employees", "Employee")
    Employee.objects.exclude(address="").update(permanent_address=models.F("address"))


def copy_address_backward(apps, schema_editor):
    """Going back, keep the permanent address; a temporary one has nowhere to go."""
    Employee = apps.get_model("employees", "Employee")
    Employee.objects.exclude(permanent_address="").update(address=models.F("permanent_address"))


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="permanent_address",
            field=models.TextField(
                blank=True, help_text="Home address of record, used for statutory paperwork."
            ),
        ),
        migrations.AddField(
            model_name="employee",
            name="temporary_address",
            field=models.TextField(
                blank=True,
                help_text="Current address, when it differs from the permanent one.",
            ),
        ),
        migrations.RunPython(copy_address_forward, copy_address_backward),
        migrations.RemoveField(
            model_name="employee",
            name="address",
        ),
    ]
