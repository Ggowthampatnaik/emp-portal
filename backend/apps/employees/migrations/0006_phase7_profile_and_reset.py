"""Phase 7: the Complete Profile gate, education document types, experience.

`profile_completed` defaults to False, which would shut **every existing
employee** out of the portal the moment this is applied - the gate is a hard
one. So anyone already on the system is grandfathered in: they joined before
the wizard existed, HR already holds their details, and locking out a whole
workforce to collect a blood group is not a trade anybody would make.

The gate therefore applies to accounts created from here on, which is exactly
who it was designed for.
"""

import django.db.models.deletion
from django.db import migrations, models


def grandfather_existing_employees(apps, schema_editor):
    Employee = apps.get_model("employees", "Employee")
    Employee.objects.update(profile_completed=True)


def reopen_the_gate(apps, schema_editor):
    """Reversing drops the column anyway; this keeps the two halves symmetrical."""
    Employee = apps.get_model("employees", "Employee")
    Employee.objects.update(profile_completed=False)


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0005_account_deletion_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="profile_completed",
            field=models.BooleanField(
                default=False,
                help_text="False until the employee has filled in the Complete Profile page. Until then the portal is closed to them - see MANDATORY_PROFILE_FIELDS.",
            ),
        ),
        migrations.RunPython(grandfather_existing_employees, reopen_the_gate),
        migrations.AlterField(
            model_name="employeedocument",
            name="document_type",
            field=models.CharField(
                choices=[
                    ("id_proof", "ID proof"),
                    ("address_proof", "Address proof"),
                    ("tenth", "10th certificate"),
                    ("intermediate", "12th / intermediate certificate"),
                    ("bachelors", "Bachelor's degree"),
                    ("masters", "Master's degree"),
                    ("other_education", "Other education certificate"),
                    ("education", "Education certificate"),
                    ("experience_letter", "Experience letter"),
                    ("experience", "Experience letter (legacy)"),
                    ("contract", "Employment contract"),
                    ("other", "Other"),
                ],
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name="ExperienceDetail",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("company_name", models.CharField(max_length=150)),
                ("job_title", models.CharField(max_length=150)),
                ("from_date", models.DateField()),
                (
                    "to_date",
                    models.DateField(
                        blank=True,
                        help_text="Blank means it ran until they joined here.",
                        null=True,
                    ),
                ),
                ("description", models.TextField(blank=True)),
                (
                    "employee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="experience_details",
                        to="employees.employee",
                    ),
                ),
            ],
            options={
                "db_table": "employee_experience",
                "ordering": ("-from_date",),
                "indexes": [
                    models.Index(
                        fields=["employee", "-from_date"], name="employee_ex_employe_eb5a0e_idx"
                    )
                ],
            },
        ),
    ]
