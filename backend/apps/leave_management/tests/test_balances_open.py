"""Everyone's leave shows from the first time they sign in."""

from datetime import date
from decimal import Decimal

import pytest

from apps.leave_management.models import LeaveBalance, LeaveType
from apps.leave_management.services import open_balances

SUMMARY = "/api/v1/dashboard/summary/"


@pytest.fixture
def leave_types(db):
    def make(code, days, **extra):
        return LeaveType.objects.create(code=code, name=code, days_per_year=Decimal(days), **extra)

    return {
        "earned": make("EL", "18"),
        "sick": make("SL", "12"),
        "unpaid": make("LOP", "60", is_paid=False),
        "maternity": make("MAT", "182", restricted_to_gender="female"),
        "retired": make("OLD", "5", is_active=False),
    }


@pytest.mark.django_db
def test_a_new_joiner_sees_their_leave_on_the_dashboard(auth_client, org, leave_types):
    assert not LeaveBalance.objects.filter(employee=org["employee"]).exists()

    me = auth_client(org["employee"]).get(SUMMARY).data["me"]

    assert Decimal(me["leave_available"]) == Decimal("30")
    assert Decimal(me["leave_entitled"]) == Decimal("30")


@pytest.mark.django_db
def test_the_dashboard_and_the_leave_page_agree(auth_client, org, leave_types):
    client = auth_client(org["employee"])
    me = client.get(SUMMARY).data["me"]

    rows = client.get("/api/v1/leave-balances/me/").data
    paid = [row for row in rows if row["leave_type_code"] in {"EL", "SL"}]

    assert len(rows) == 3
    assert sum(Decimal(row["allocated_days"]) for row in paid) == Decimal(me["leave_entitled"])


@pytest.mark.django_db
def test_opening_twice_does_not_reset_what_is_held(org, leave_types):
    year = date.today().year
    open_balances(org["employee"], year)
    LeaveBalance.objects.filter(employee=org["employee"], leave_type=leave_types["earned"]).update(
        used_days=Decimal("3")
    )

    open_balances(org["employee"], year)

    balance = LeaveBalance.objects.get(employee=org["employee"], leave_type=leave_types["earned"])
    assert balance.used_days == Decimal("3")
    assert LeaveBalance.objects.filter(employee=org["employee"]).count() == 3


@pytest.mark.django_db
def test_a_type_they_are_not_eligible_for_is_not_opened(org, leave_types):
    org["employee"].gender = "male"
    org["employee"].save()

    open_balances(org["employee"], date.today().year)

    assert not LeaveBalance.objects.filter(
        employee=org["employee"], leave_type=leave_types["maternity"]
    ).exists()


@pytest.mark.django_db
def test_a_retired_type_is_not_opened(org, leave_types):
    open_balances(org["employee"], date.today().year)

    assert not LeaveBalance.objects.filter(leave_type=leave_types["retired"]).exists()


@pytest.mark.django_db
def test_a_returning_dashboard_opens_nothing_new(
    auth_client, org, leave_types, django_assert_num_queries
):
    client = auth_client(org["employee"])
    client.get(SUMMARY)
    count = LeaveBalance.objects.count()

    client.get(SUMMARY)

    assert LeaveBalance.objects.count() == count
