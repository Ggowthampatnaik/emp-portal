"""Puts months already approved in front of Finance.

Approval used to leave each payslip with HR to send singly. Sending the month is
now one step, so a run that is with Finance has all its payslips in the queue;
this brings the runs that got there the old way into line.
"""

from django.db import migrations


def queue(apps, schema_editor):
    PayrollRun = apps.get_model("payroll", "PayrollRun")
    PayslipApproval = apps.get_model("finance", "PayslipApproval")

    for run in PayrollRun.objects.filter(status="with_finance"):
        for payslip_id in run.payslips.values_list("pk", flat=True):
            PayslipApproval.objects.filter(payslip_id=payslip_id, status="pending").delete()
            PayslipApproval.objects.get_or_create(
                payslip_id=payslip_id,
                defaults={
                    "status": "processed",
                    "processed_by_id": run.sent_by_id,
                    "processed_at": run.sent_at,
                },
            )


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0001_payslip_approval"),
        ("payroll", "0002_finance_led_runs"),
    ]

    operations = [
        migrations.RunPython(queue, migrations.RunPython.noop),
    ]
