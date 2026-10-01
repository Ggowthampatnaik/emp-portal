"""The back-fill that stops the Complete Profile gate locking out the company.

`profile_completed` defaults to False. Applied as-is, the migration would shut
every existing employee out of the portal the moment it ran - the gate is a hard
one, so "everyone" means everyone. The migration therefore grandfathers anyone
already on the system.

This is the kind of thing that is obvious in review and invisible afterwards, so
it gets a test that runs the migration for real.
"""

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.employees.models import Employee

BEFORE = ("employees", "0005_account_deletion_request")
AFTER = ("employees", "0006_phase7_profile_and_reset")


def migrate_to(target):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate([target])
    executor.loader.build_graph()
    return executor.loader.project_state([target]).apps


@pytest.fixture
def before_the_gate(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        yield migrate_to(BEFORE)
        migrate_to(AFTER)


@pytest.mark.django_db(transaction=True)
def test_everyone_already_on_the_system_keeps_their_access(before_the_gate, django_db_blocker):
    with django_db_blocker.unblock():
        user = get_user_model().objects.create_user(
            email="established@trigyan.io", password="Fixture@123"
        )
        # Written through the pre-gate schema, so the column does not exist yet.
        old = before_the_gate.get_model("employees", "Employee")
        old.objects.create(user_id=user.pk, employee_code="TRG8000", date_of_joining="2021-03-01")

        migrate_to(AFTER)

        assert Employee.objects.get(employee_code="TRG8000").profile_completed is True


@pytest.mark.django_db(transaction=True)
def test_someone_created_after_the_gate_still_has_to_complete_it(
    before_the_gate, django_db_blocker
):
    """The grandfathering is a one-off, not a permanent exemption."""
    with django_db_blocker.unblock():
        migrate_to(AFTER)

        user = get_user_model().objects.create_user(
            email="newjoiner@trigyan.io", password="Fixture@123"
        )
        employee = Employee.objects.create(
            user=user, employee_code="TRG8001", date_of_joining="2026-08-25"
        )

        assert employee.profile_completed is False
