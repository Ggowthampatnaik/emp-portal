"""Loss of Pay gets a yearly allowance of 60 days.

It was 0 days and uncapped. The company caps unpaid leave at 60 days a year,
so the type's allowance and every existing Loss of Pay balance are set to 60.
Balances keep what was used and is pending; only the allowance changes. New
balances pick the 60 up from the type when they are opened.
"""

from decimal import Decimal

from django.db import migrations

CODE = "LOP"
DAYS = Decimal("60.0")


def set_allowance(apps, schema_editor):
    LeaveType = apps.get_model("leave_management", "LeaveType")
    LeaveBalance = apps.get_model("leave_management", "LeaveBalance")
    LeaveType.objects.filter(code=CODE).update(days_per_year=DAYS)
    LeaveBalance.objects.filter(leave_type__code=CODE).update(allocated_days=DAYS)


def clear_allowance(apps, schema_editor):
    LeaveType = apps.get_model("leave_management", "LeaveType")
    LeaveBalance = apps.get_model("leave_management", "LeaveBalance")
    LeaveType.objects.filter(code=CODE).update(days_per_year=Decimal("0.0"))
    LeaveBalance.objects.filter(leave_type__code=CODE).update(allocated_days=Decimal("0.0"))


class Migration(migrations.Migration):
    dependencies = [
        ("leave_management", "0006_remove_gender_other"),
    ]

    operations = [
        migrations.RunPython(set_allowance, clear_allowance),
    ]
