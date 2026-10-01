"""Leave becomes two-stage: Employee -> Manager -> HR (decisions D1 and D2).

Written as add -> back-fill -> switch. The back-fill is the point of the whole
migration: an existing ``approved`` row was approved once, under a single-stage
rule, and must come out the other side looking like it cleared *both* stages -
otherwise every historical request would appear to be still sitting with HR.

The reverse collapses the two pending states back to ``pending`` before the
columns are dropped, so downgrading does not leave unreadable status values in
the table.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def to_two_stage(apps, schema_editor):
    LeaveRequest = apps.get_model("leave_management", "LeaveRequest")

    # Awaiting a decision -> waiting on the manager, stage one.
    LeaveRequest.objects.filter(status="pending").update(
        status="pending_manager", manager_status="pending", hr_status="pending"
    )

    # Already approved -> both stages passed, credited to whoever decided it.
    # `decided_by`/`decided_at` are the only record of who that was.
    for row in LeaveRequest.objects.filter(status="approved").iterator():
        LeaveRequest.objects.filter(pk=row.pk).update(
            manager_status="approved",
            manager_decided_by_id=row.decided_by_id,
            manager_decided_at=row.decided_at,
            manager_comment=row.decision_comment,
            hr_status="approved",
            hr_decided_by_id=row.decided_by_id,
            hr_decided_at=row.decided_at,
            hr_comment=row.decision_comment,
        )

    # Rejected -> the manager stage rejected it; HR never saw it.
    for row in LeaveRequest.objects.filter(status="rejected").iterator():
        LeaveRequest.objects.filter(pk=row.pk).update(
            manager_status="rejected",
            manager_decided_by_id=row.decided_by_id,
            manager_decided_at=row.decided_at,
            manager_comment=row.decision_comment,
            hr_status="pending",
        )

    # Cancelled rows keep their status; neither stage ever decided.


def to_single_stage(apps, schema_editor):
    LeaveRequest = apps.get_model("leave_management", "LeaveRequest")
    LeaveRequest.objects.filter(status__in=["pending_manager", "pending_hr"]).update(
        status="pending"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("leave_management", "0002_holiday_description"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="hr_comment",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="hr_decided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="hr_decided_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="leave_hr_decisions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="hr_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("sent_back", "Sent back to manager"),
                ],
                default="pending",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="manager_comment",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="manager_decided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="manager_decided_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="leave_manager_decisions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="manager_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("sent_back", "Sent back to manager"),
                ],
                default="pending",
                max_length=12,
            ),
        ),
        migrations.AlterField(
            model_name="leaveapproval",
            name="action",
            field=models.CharField(
                choices=[
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("cancelled", "Cancelled"),
                    ("manager_approved", "Approved by manager"),
                    ("hr_approved", "Approved by HR"),
                    ("sent_back", "Sent back to manager"),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="leaverequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending_manager", "Pending manager"),
                    ("pending_hr", "Pending HR"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("cancelled", "Cancelled"),
                ],
                db_index=True,
                default="pending_manager",
                max_length=20,
            ),
        ),
        migrations.RunPython(to_two_stage, to_single_stage),
        migrations.CreateModel(
            name="LeaveRequestCC",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("notified_at", models.DateTimeField(blank=True, null=True)),
                (
                    "leave_request",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cc_recipients",
                        to="leave_management.leaverequest",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="leave_cc",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "leave_request_cc",
                "ordering": ("user__first_name", "user__last_name"),
                "constraints": [
                    models.UniqueConstraint(fields=("leave_request", "user"), name="uniq_leave_cc")
                ],
            },
        ),
    ]
