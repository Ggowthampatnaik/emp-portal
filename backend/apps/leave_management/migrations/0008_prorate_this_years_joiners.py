"""Brings balances already opened at the full year into line with pro-rating.

Only for someone in the year they joined, on paid leave that is pro-rated, with
nothing used or reserved against it, and still at the standard allocation. A
figure HR set by hand is left alone, and so is any balance with leave on it.

The rule is copied rather than imported, so this keeps doing what it did when
it was written. Backwards restores the full year to the same balances.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations

CUTOFF_DAY = 15


def prorated(full, joined):
    months = 12 - joined.month + (1 if joined.day <= CUTOFF_DAY else 0)
    return (full * months / 12 * 2).quantize(Decimal("1"), rounding=ROUND_HALF_UP) / 2


def candidates(apps):
    balances = apps.get_model("leave_management", "LeaveBalance").objects.filter(
        used_days=0,
        pending_days=0,
        leave_type__is_paid=True,
        leave_type__restricted_to_gender="",
    )
    for balance in balances.select_related("employee", "leave_type"):
        if balance.year == balance.employee.date_of_joining.year:
            yield balance


def forward(apps, schema_editor):
    for balance in candidates(apps):
        full = balance.leave_type.days_per_year
        if balance.allocated_days == full:
            balance.allocated_days = prorated(full, balance.employee.date_of_joining)
            balance.save(update_fields=["allocated_days"])


def backward(apps, schema_editor):
    for balance in candidates(apps):
        full = balance.leave_type.days_per_year
        if balance.allocated_days == prorated(full, balance.employee.date_of_joining):
            balance.allocated_days = full
            balance.save(update_fields=["allocated_days"])


class Migration(migrations.Migration):
    dependencies = [
        ("leave_management", "0007_loss_of_pay_sixty_days"),
        ("employees", "0014_date_of_birth_minimum_age"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
