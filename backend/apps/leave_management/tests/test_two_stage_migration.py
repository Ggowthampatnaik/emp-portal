"""The data migration that converts single-stage leave to two stages.

This is the one piece of Phase 3 that touches rows a customer already has, and
it only ever runs once. If it is wrong, every historical request either looks
stuck with HR forever or loses the record of who approved it - and by the time
anyone notices, the migration has been applied.

So it is tested the same way the code is: run it against rows in the old shape
and assert what comes out, then run it backwards and assert the table is
readable again.
"""

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from apps.employees.models import Employee

BEFORE = ("leave_management", "0002_holiday_description")
AFTER = ("leave_management", "0003_two_stage_approval_and_cc")


def migrate_to(target):
    """Runs the project's migrations to `target` and returns that state's models."""
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate([target])
    executor.loader.build_graph()
    return executor.loader.project_state([target]).apps


@pytest.fixture
def old_state(django_db_setup, django_db_blocker):
    """The schema as it was before leave became two-stage."""
    with django_db_blocker.unblock():
        yield migrate_to(BEFORE)
        # Leave the database at the latest migration for everything that follows.
        migrate_to(AFTER)


def make_employee(email, code):
    """A real user and employment record - only leave_management is rewound."""
    user = get_user_model().objects.create_user(email=email, password="Fixture@123")
    return Employee.objects.create(user=user, employee_code=code, date_of_joining="2022-01-03")


def seed_old_rows(apps, employee, actor_id):
    """One request in each single-stage state, written through the old schema."""
    LeaveRequest = apps.get_model("leave_management", "LeaveRequest")
    LeaveType = apps.get_model("leave_management", "LeaveType")

    leave_type = LeaveType.objects.create(code="EL", name="Earned Leave", days_per_year="18.0")
    decided = timezone.now()

    made = {}
    for status in ("pending", "approved", "rejected", "cancelled"):
        made[status] = LeaveRequest.objects.create(
            employee_id=employee.pk,
            leave_type=leave_type,
            start_date="2026-03-02",
            end_date="2026-03-03",
            total_days="2.0",
            reason=f"A {status} request.",
            status=status,
            decided_by_id=None if status in ("pending", "cancelled") else actor_id,
            decided_at=None if status in ("pending", "cancelled") else decided,
            decision_comment="" if status == "pending" else "Handled.",
        )
    return made


@pytest.mark.django_db(transaction=True)
def test_old_rows_come_out_in_the_right_stage(old_state, django_db_blocker):
    with django_db_blocker.unblock():
        actor = make_employee("vikram.migration@trigyan.io", "TRG9000").user
        employee = make_employee("asha.migration@trigyan.io", "TRG9001")
        old = seed_old_rows(old_state, employee, actor.pk)

        new_state = migrate_to(AFTER)
        LeaveRequest = new_state.get_model("leave_management", "LeaveRequest")
        rows = {key: LeaveRequest.objects.get(pk=request.pk) for key, request in old.items()}

        # Waiting for a decision -> waiting on the manager, nothing decided yet.
        assert rows["pending"].status == "pending_manager"
        assert rows["pending"].manager_status == "pending"
        assert rows["pending"].hr_status == "pending"

        # Already approved -> both stages passed, credited to whoever decided it.
        assert rows["approved"].status == "approved"
        assert rows["approved"].manager_status == "approved"
        assert rows["approved"].hr_status == "approved"
        assert rows["approved"].manager_decided_by_id == actor.pk
        assert rows["approved"].hr_decided_by_id == actor.pk
        assert rows["approved"].manager_decided_at is not None

        # Rejected -> the manager stopped it; HR never saw it.
        assert rows["rejected"].status == "rejected"
        assert rows["rejected"].manager_status == "rejected"
        assert rows["rejected"].hr_status == "pending"

        # Cancelled -> untouched; neither stage ever decided.
        assert rows["cancelled"].status == "cancelled"
        assert rows["cancelled"].manager_status == "pending"
        assert rows["cancelled"].hr_status == "pending"


@pytest.mark.django_db(transaction=True)
def test_going_back_leaves_readable_statuses(old_state, django_db_blocker):
    """Downgrading must not leave `pending_manager` in a `pending`-only column."""
    with django_db_blocker.unblock():
        employee = make_employee("asha.downgrade@trigyan.io", "TRG9002")
        old = seed_old_rows(old_state, employee, None)

        migrate_to(AFTER)
        back = migrate_to(BEFORE)

        LeaveRequest = back.get_model("leave_management", "LeaveRequest")
        assert LeaveRequest.objects.get(pk=old["pending"].pk).status == "pending"
        assert LeaveRequest.objects.get(pk=old["approved"].pk).status == "approved"
        assert not LeaveRequest.objects.filter(
            status__in=["pending_manager", "pending_hr"]
        ).exists()
