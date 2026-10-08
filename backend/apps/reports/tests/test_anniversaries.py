"""Work anniversaries on the dashboard: the yearly return of a joining date."""

from datetime import date

import pytest
from freezegun import freeze_time

from apps.employees.models import Employee
from apps.reports.upcoming import upcoming_anniversaries
from common.enums import EmploymentStatus


def joined(employee, when: date):
    employee.date_of_joining = when
    employee.save(update_fields=["date_of_joining"])
    return employee


def far_off(org):
    """Moves everyone's anniversary out of the way, so each test sees only its own."""
    Employee.objects.update(date_of_joining=date(2020, 6, 15))


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_an_anniversary_in_the_window_is_listed_with_the_years_completed(org):
    far_off(org)
    joined(org["employee"], date(2021, 10, 17))

    rows = upcoming_anniversaries(horizon_days=30)

    entry = next(row for row in rows if row["employee_code"] == "TRG0005")
    assert entry["years"] == 5
    assert entry["days_until"] == 10
    assert entry["celebrated_on"] == date(2026, 10, 17)
    assert entry["is_today"] is False


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_todays_anniversary_is_flagged(org):
    far_off(org)
    joined(org["employee"], date(2016, 10, 7))

    entry = upcoming_anniversaries(horizon_days=30)[0]
    assert entry["is_today"] is True
    assert entry["years"] == 10


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_someone_who_joined_this_year_has_no_anniversary_yet(org):
    far_off(org)
    joined(org["employee"], date(2026, 10, 20))  # joins later this month

    assert upcoming_anniversaries(horizon_days=30) == []


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_outside_the_window_is_not_listed(org):
    far_off(org)
    joined(org["employee"], date(2020, 12, 25))

    assert upcoming_anniversaries(horizon_days=30) == []


@pytest.mark.django_db
@freeze_time("2026-12-20")
def test_the_window_rolls_over_the_new_year(org):
    far_off(org)
    joined(org["employee"], date(2019, 1, 5))

    entry = upcoming_anniversaries(horizon_days=30)[0]
    assert entry["celebrated_on"] == date(2027, 1, 5)
    assert entry["years"] == 8


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_people_who_have_left_are_not_celebrated(org):
    far_off(org)
    joined(org["employee"], date(2021, 10, 17))
    Employee.objects.filter(pk=org["employee"].pk).update(
        employment_status=EmploymentStatus.INACTIVE
    )

    assert upcoming_anniversaries(horizon_days=30) == []


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_the_soonest_comes_first(org):
    far_off(org)
    joined(org["employee"], date(2021, 10, 30))
    joined(org["peer"], date(2023, 10, 9))

    codes = [row["employee_code"] for row in upcoming_anniversaries(horizon_days=30)]
    assert codes == ["TRG0006", "TRG0005"]


@pytest.mark.django_db
@freeze_time("2026-10-07")
def test_the_dashboard_and_the_calendar_both_carry_them(auth_client, org):
    far_off(org)
    joined(org["employee"], date(2021, 10, 17))
    client = auth_client(org["peer"])  # any signed-in employee

    summary = client.get("/api/v1/dashboard/summary/")
    assert summary.status_code == 200
    assert [row["years"] for row in summary.data["upcoming_anniversaries"]] == [5]

    calendar = client.get("/api/v1/dashboard/anniversaries/")
    assert calendar.status_code == 200
    # A year's window reaches everyone once - the mid-June joiners included.
    assert calendar.data["count"] == Employee.objects.count()
