"""Renames temporary_address to current_address, and adds blood group + photo.

The auto-generated migration removed ``temporary_address`` and added
``current_address`` as an unrelated column, which would have thrown away every
address already captured. ``RenameField`` keeps the data and works in reverse.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0002_split_address"),
    ]

    operations = [
        migrations.RenameField(
            model_name="employee",
            old_name="temporary_address",
            new_name="current_address",
        ),
        migrations.AlterField(
            model_name="employee",
            name="current_address",
            field=models.TextField(
                blank=True,
                help_text=(
                    "Where the employee lives now, when it differs from the permanent one."
                ),
            ),
        ),
        migrations.AddField(
            model_name="employee",
            name="blood_group",
            field=models.CharField(
                blank=True,
                choices=[
                    ("A+", "A+"),
                    ("A-", "A-"),
                    ("B+", "B+"),
                    ("B-", "B-"),
                    ("AB+", "AB+"),
                    ("AB-", "AB-"),
                    ("O+", "O+"),
                    ("O-", "O-"),
                ],
                help_text="Kept for emergency contact purposes only.",
                max_length=3,
            ),
        ),
        migrations.AddField(
            model_name="employee",
            name="photo",
            field=models.ImageField(
                blank=True,
                help_text=(
                    "Profile photo; stored in Azure Blob Storage in deployed environments."
                ),
                null=True,
                upload_to="employee-photos/%Y/%m/",
            ),
        ),
    ]
