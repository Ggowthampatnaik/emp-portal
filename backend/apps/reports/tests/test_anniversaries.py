"""Work anniversaries on the dashboard: the yearly return of a joining date."""

from datetime import date

import pytest
from freezegun import freeze_time

from apps.employees.models import Employee
from apps.reports.upcoming import anniversaries_this_month, upcoming_anniversaries
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
    # October's one, then - a quiet month - the next to come (the June joiners).
    rows = summary.data["upcoming_anniversaries"]
    assert [(row["years"], row["celebrated_on"]) for row in rows] == [
        (5, date(2026, 10, 17)),
        (7, date(2027, 6, 15)),
    ]

    calendar = client.get("/api/v1/dashboard/anniversaries/")
    assert calendar.status_code == 200
    # A year's window reaches everyone once - the mid-June joiners included.
    assert calendar.data["count"] == Employee.objects.count()


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_earlier_this_month_is_kept_when_asked(org):
    far_off(org)
    joined(org["employee"], date(2020, 10, 5))  # 6 years on 5 Oct, four days ago

    # The rolling window alone has moved past it...
    assert upcoming_anniversaries(horizon_days=30) == []

    # ...but the dashboard asks for the month so far as well.
    entry = upcoming_anniversaries(horizon_days=30, include_month_so_far=True)[0]
    assert entry["days_until"] == -4
    assert entry["celebrated_on"] == date(2026, 10, 5)
    assert entry["years"] == 6
    assert entry["is_today"] is False


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_last_months_anniversary_is_not_pulled_in(org):
    far_off(org)
    joined(org["employee"], date(2020, 9, 30))

    assert upcoming_anniversaries(horizon_days=30, include_month_so_far=True) == []


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_the_dashboard_card_shows_this_months_earlier_anniversaries(auth_client, org):
    far_off(org)
    joined(org["employee"], date(2020, 10, 5))
    client = auth_client(org["peer"])

    summary = client.get("/api/v1/dashboard/summary/")
    assert summary.status_code == 200
    rows = summary.data["upcoming_anniversaries"]
    assert (rows[0]["years"], rows[0]["days_until"]) == (6, -4)
    assert len(rows) == 2  # topped up with the next one after October


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_this_month_runs_from_the_first_to_the_last_day_and_no_further(org):
    far_off(org)
    joined(org["employee"], date(2020, 10, 1))
    joined(org["peer"], date(2022, 10, 31))
    joined(org["manager"], date(2019, 11, 2))  # next month: not on the card

    rows = anniversaries_this_month()
    assert [row["celebrated_on"] for row in rows] == [date(2026, 10, 1), date(2026, 10, 31)]


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_this_month_is_not_capped(org):
    """The card shows two and counts the rest, so it needs all of them."""
    Employee.objects.update(date_of_joining=date(2020, 10, 20))

    assert len(anniversaries_this_month()) == Employee.objects.count()


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_a_quiet_month_is_topped_up_with_the_next_ones(org):
    far_off(org)  # everyone else: 15 June
    joined(org["employee"], date(2020, 10, 5))  # the month's only one
    joined(org["peer"], date(2020, 11, 23))  # next after it
    joined(org["manager"], date(2019, 12, 1))

    rows = anniversaries_this_month(at_least=2)
    assert [row["celebrated_on"] for row in rows] == [date(2026, 10, 5), date(2026, 11, 23)]


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_a_busy_month_is_not_topped_up(org):
    far_off(org)
    joined(org["employee"], date(2020, 10, 5))
    joined(org["peer"], date(2021, 10, 20))
    joined(org["manager"], date(2019, 11, 2))

    rows = anniversaries_this_month(at_least=2)
    assert [row["celebrated_on"].month for row in rows] == [10, 10]


@pytest.mark.django_db
@freeze_time("2026-10-09")
def test_rows_say_whether_they_fall_this_month(org):
    far_off(org)
    joined(org["employee"], date(2020, 10, 5))
    joined(org["peer"], date(2020, 11, 23))

    rows = anniversaries_this_month(at_least=2)
    assert [row["this_month"] for row in rows] == [True, False]
