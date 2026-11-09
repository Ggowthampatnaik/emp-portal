"""Leave in the year someone joins follows their joining date."""

from datetime import date
from decimal import Decimal
from importlib import import_module

import pytest
from django.apps import apps

from apps.leave_management.models import LeaveBalance, LeaveType
from apps.leave_management.services import entitlement_for, get_or_create_balance

YEAR = date.today().year
migration = import_module("apps.leave_management.migrations.0008_prorate_this_years_joiners")


@pytest.fixture
def earned(db):
    return LeaveType.objects.create(code="EL", name="Earned", days_per_year=Decimal("18"))


@pytest.fixture
def casual(db):
    return LeaveType.objects.create(code="CL", name="Casual", days_per_year=Decimal("8"))


def joined(employee, on):
    employee.date_of_joining = on
    employee.save(update_fields=["date_of_joining"])
    return employee


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("joining", "days"),
    [
        (date(2026, 1, 1), "18"),  # the whole year
        (date(2026, 1, 16), "16.5"),  # eleven months
        (date(2026, 7, 1), "9"),  # six months: half the year
        (date(2026, 7, 6), "9"),  # by the 15th, so July counts
        (date(2026, 7, 15), "9"),
        (date(2026, 7, 16), "7.5"),  # after the 15th, so it does not
        (date(2026, 11, 4), "3"),
        (date(2026, 12, 1), "1.5"),
        (date(2026, 12, 20), "0"),  # nothing left of the year
    ],
)
def test_the_joining_date_sets_the_days(org, earned, joining, days):
    assert entitlement_for(joined(org["employee"], joining), earned, 2026) == Decimal(days)


@pytest.mark.django_db
def test_days_round_to_the_nearest_half(org, casual):
    # 8 x 4 / 12 = 2.67, which nobody can take.
    employee = joined(org["employee"], date(2026, 9, 3))

    assert entitlement_for(employee, casual, 2026) == Decimal("2.5")


@pytest.mark.django_db
def test_the_next_year_is_the_full_amount(org, earned):
    employee = joined(org["employee"], date(2026, 11, 4))

    assert entitlement_for(employee, earned, 2027) == Decimal("18")


@pytest.mark.django_db
def test_unpaid_leave_is_not_reduced(org):
    unpaid = LeaveType.objects.create(
        code="LOP", name="Loss of Pay", days_per_year=Decimal("60"), is_paid=False
    )
    employee = joined(org["employee"], date(2026, 11, 4))

    assert entitlement_for(employee, unpaid, 2026) == Decimal("60")


@pytest.mark.django_db
def test_maternity_leave_is_not_reduced(org):
    maternity = LeaveType.objects.create(
        code="MAT", name="Maternity", days_per_year=Decimal("182"), restricted_to_gender="female"
    )
    employee = joined(org["employee"], date(2026, 11, 4))

    assert entitlement_for(employee, maternity, 2026) == Decimal("182")


@pytest.mark.django_db
def test_someone_here_for_years_gets_the_full_amount(org, earned):
    assert get_or_create_balance(org["employee"], earned, YEAR).allocated_days == Decimal("18")


@pytest.mark.django_db
def test_the_balance_and_the_dashboard_show_the_reduced_days(auth_client, org, earned, casual):
    joined(org["employee"], date(YEAR, 7, 6))

    me = auth_client(org["employee"]).get("/api/v1/dashboard/summary/").data["me"]

    assert Decimal(me["leave_entitled"]) == Decimal("13")  # 9 earned + 4 casual
    assert Decimal(me["leave_available"]) == Decimal("13")


@pytest.mark.django_db
def test_an_existing_balance_is_not_reopened(org, earned):
    employee = org["employee"]
    LeaveBalance.objects.create(
        employee=employee, leave_type=earned, year=YEAR, allocated_days=Decimal("25")
    )
    joined(employee, date(YEAR, 7, 6))

    assert get_or_create_balance(employee, earned, YEAR).allocated_days == Decimal("25")


# ---------------------------------------------------------------------------
# Balances already opened at the full year
# ---------------------------------------------------------------------------
def opened(employee, leave_type, year=2026, **fields):
    defaults = {"allocated_days": leave_type.days_per_year, **fields}
    return LeaveBalance.objects.create(
        employee=employee, leave_type=leave_type, year=year, **defaults
    )


@pytest.mark.django_db
def test_an_untouched_full_year_balance_is_corrected(org, earned):
    balance = opened(joined(org["employee"], date(2026, 7, 6)), earned)

    migration.forward(apps, None)

    balance.refresh_from_db()
    assert balance.allocated_days == Decimal("9")


@pytest.mark.django_db
@pytest.mark.parametrize("taken", [{"used_days": Decimal("1")}, {"pending_days": Decimal("1")}])
def test_a_balance_with_leave_on_it_is_left_alone(org, earned, taken):
    balance = opened(joined(org["employee"], date(2026, 7, 6)), earned, **taken)

    migration.forward(apps, None)

    balance.refresh_from_db()
    assert balance.allocated_days == Decimal("18")


@pytest.mark.django_db
def test_a_figure_hr_set_by_hand_is_left_alone(org, earned):
    balance = opened(
        joined(org["employee"], date(2026, 7, 6)), earned, allocated_days=Decimal("12")
    )

    migration.forward(apps, None)

    balance.refresh_from_db()
    assert balance.allocated_days == Decimal("12")


@pytest.mark.django_db
def test_a_later_year_is_left_alone(org, earned):
    balance = opened(joined(org["employee"], date(2025, 7, 6)), earned, year=2026)

    migration.forward(apps, None)

    balance.refresh_from_db()
    assert balance.allocated_days == Decimal("18")


@pytest.mark.django_db
def test_it_can_be_undone(org, earned):
    balance = opened(joined(org["employee"], date(2026, 7, 6)), earned)

    migration.forward(apps, None)
    migration.backward(apps, None)

    balance.refresh_from_db()
    assert balance.allocated_days == Decimal("18")
