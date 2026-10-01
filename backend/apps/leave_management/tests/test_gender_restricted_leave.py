"""Gender-restricted leave types - maternity leave, concretely.

The rule everywhere is the same: a restricted type simply does not exist for
anyone it excludes. No balance is opened, none is listed, applying is refused -
and for the people who *do* hold it, the entitlement stays off the dashboard's
headline number, where 182 days would drown the ordinary year.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.leave_management.models import LeaveType
from common.exceptions import BusinessRuleViolation

BALANCES_ME = "/api/v1/leave-balances/me/"
DASHBOARD = "/api/v1/dashboard/summary/"


@pytest.fixture
def maternity(db):
    return LeaveType.objects.create(
        code="MAT",
        name="Maternity Leave",
        days_per_year=Decimal("182.0"),
        restricted_to_gender="female",
    )


def set_gender(employee, gender):
    employee.gender = gender
    employee.save(update_fields=["gender"])
    return employee


@pytest.mark.django_db
def test_no_balance_exists_for_a_male_employee(auth_client, org, maternity):
    set_gender(org["employee"], "male")

    rows = auth_client(org["employee"]).get(BALANCES_ME).data

    assert "MAT" not in {row["leave_type_code"] for row in rows}


@pytest.mark.django_db
def test_the_balance_exists_for_a_female_employee(auth_client, org, maternity):
    set_gender(org["employee"], "female")

    rows = auth_client(org["employee"]).get(BALANCES_ME).data

    matched = [row for row in rows if row["leave_type_code"] == "MAT"]
    assert len(matched) == 1
    assert Decimal(matched[0]["allocated_days"]) == Decimal("182.0")


@pytest.mark.django_db
def test_an_unset_gender_does_not_qualify(auth_client, org, maternity):
    """Entitlement follows from what the profile says, not what it leaves blank."""
    set_gender(org["employee"], "")

    rows = auth_client(org["employee"]).get(BALANCES_ME).data

    assert "MAT" not in {row["leave_type_code"] for row in rows}


@pytest.mark.django_db
def test_applying_is_refused_for_the_excluded(org, maternity):
    from apps.leave_management.services import apply_for_leave

    set_gender(org["employee"], "male")
    monday = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)

    with pytest.raises(BusinessRuleViolation, match="not available on your profile"):
        apply_for_leave(org["employee"], maternity, monday, monday, "test")


@pytest.mark.django_db
def test_the_dashboard_total_never_counts_a_restricted_type(auth_client, org, maternity):
    """182 days of maternity leave must not become the headline number - it
    keeps its own card on the Leave page and stays out of the total."""
    set_gender(org["employee"], "female")
    client = auth_client(org["employee"])
    client.get(BALANCES_ME)  # opens the MAT balance

    me = client.get(DASHBOARD).data["me"]

    assert Decimal(me["leave_entitled"]) < Decimal("182.0")


# ---------------------------------------------------------------------------
# A profile that changes after the balance was opened
# ---------------------------------------------------------------------------
# Eligibility was checked when a balance was opened and again when balances
# were listed, but nothing revisited the rows already in the table. Correcting
# somebody's gender left the old maternity balance behind - hidden on the page,
# because the list filters on gender too, but present in the row count, in an
# export, and to anything querying balances directly.
@pytest.mark.django_db
def test_changing_gender_closes_a_balance_that_no_longer_applies(org, maternity):
    from apps.leave_management.models import LeaveBalance
    from apps.leave_management.services import get_or_create_balance

    employee = set_gender(org["employee"], "female")
    get_or_create_balance(employee, maternity, date.today().year)
    assert LeaveBalance.objects.filter(employee=employee, leave_type=maternity).exists()

    set_gender(employee, "male")

    assert not LeaveBalance.objects.filter(employee=employee, leave_type=maternity).exists()


@pytest.mark.django_db
def test_an_unrestricted_balance_survives_a_gender_change(org, maternity):
    from apps.leave_management.models import LeaveBalance
    from apps.leave_management.services import get_or_create_balance

    casual = LeaveType.objects.create(code="CL2", name="Casual", days_per_year=Decimal("8.0"))
    employee = set_gender(org["employee"], "female")
    get_or_create_balance(employee, casual, date.today().year)

    set_gender(employee, "male")

    assert LeaveBalance.objects.filter(employee=employee, leave_type=casual).exists()


@pytest.mark.django_db
def test_a_balance_with_days_taken_is_left_alone(org, maternity):
    """Leave already taken is a record, and cannot retroactively un-happen.

    Entitlement can stop applying from here on, but silently deleting the row
    that says somebody was on maternity leave for eleven weeks would destroy
    history on a profile edit. HR resolves these, not a signal handler.
    """
    from apps.leave_management.models import LeaveBalance
    from apps.leave_management.services import get_or_create_balance

    employee = set_gender(org["employee"], "female")
    balance = get_or_create_balance(employee, maternity, date.today().year)
    balance.used_days = Decimal("30.0")
    balance.save(update_fields=["used_days"])

    set_gender(employee, "male")

    assert LeaveBalance.objects.filter(pk=balance.pk).exists()
