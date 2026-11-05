"""Payroll runs go from HR to Finance, with no administrator's approval.

Whoever approved a run under the old process is who sent it onwards, so those
columns are renamed rather than replaced, and an approved run is with Finance.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def to_finance(apps, schema_editor):
    apps.get_model("payroll", "PayrollRun").objects.filter(status="approved").update(
        status="with_finance"
    )


def to_approved(apps, schema_editor):
    apps.get_model("payroll", "PayrollRun").objects.filter(status="with_finance").update(
        status="approved"
    )


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("payroll", "0001_initial"),
    ]

    operations = [
        migrations.RenameField("payrollrun", "approved_by", "sent_by"),
        migrations.RenameField("payrollrun", "approved_at", "sent_at"),
        migrations.AlterField(
            model_name="payrollrun",
            name="sent_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs_sent",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="paid_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs_paid",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="payrollrun",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("processed", "Processed"),
                    ("with_finance", "With Finance"),
                    ("paid", "Paid"),
                ],
                default="draft",
                max_length=12,
            ),
        ),
        migrations.RunPython(to_finance, to_approved),
    ]
