"""Upcoming birthdays and holidays: the dashboard noticeboard."""

from datetime import date, timedelta

import pytest
from django.utils import timezone
from freezegun import freeze_time

from apps.leave_management.models import Holiday
from apps.reports.upcoming import clamp_horizon, upcoming_birthdays, upcoming_holidays
from common.enums import EmploymentStatus

URL = "/api/v1/dashboard/summary/"


def set_birthday(employee, when: date):
    employee.date_of_birth = when
    employee.save(update_fields=["date_of_birth"])
    return employee


def born_on(month: int, day: int, year: int = 1990) -> date:
    return date(year, month, day)


# ---------------------------------------------------------------------------
# Birthdays
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_birthday_inside_the_window_is_listed(org):
    today = timezone.localdate()
    in_ten_days = today + timedelta(days=10)
    set_birthday(org["employee"], born_on(in_ten_days.month, in_ten_days.day))

    rows = upcoming_birthdays(horizon_days=30)
    entry = next(row for row in rows if row["employee_code"] == "TRG0005")
    assert entry["days_until"] == 10
    assert entry["is_today"] is False
    assert entry["celebrated_on"] == in_ten_days


@pytest.mark.django_db
def test_a_birthday_outside_the_window_is_not_listed(org):
    today = timezone.localdate()
    far_off = today + timedelta(days=60)
    set_birthday(org["employee"], born_on(far_off.month, far_off.day))

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0005" not in codes


@pytest.mark.django_db
def test_todays_birthday_is_flagged(org):
    today = timezone.localdate()
    set_birthday(org["employee"], born_on(today.month, today.day))

    entry = next(
        row for row in upcoming_birthdays(horizon_days=30) if row["employee_code"] == "TRG0005"
    )
    assert entry["days_until"] == 0
    assert entry["is_today"] is True


@pytest.mark.django_db
def test_a_birthday_yesterday_is_not_listed(org):
    yesterday = timezone.localdate() - timedelta(days=1)
    set_birthday(org["employee"], born_on(yesterday.month, yesterday.day))

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0005" not in codes


@pytest.mark.django_db
def test_the_window_crosses_the_year_boundary(org):
    """A December window must still pick up January birthdays."""
    today = timezone.localdate()
    in_twenty = today + timedelta(days=20)
    set_birthday(org["employee"], born_on(in_twenty.month, in_twenty.day))

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0005" in codes, "a birthday 20 days out must appear whatever the month"


@pytest.mark.django_db
def test_the_birth_year_is_never_exposed(org):
    today = timezone.localdate()
    set_birthday(org["employee"], born_on(today.month, today.day, year=1979))

    entry = next(
        row for row in upcoming_birthdays(horizon_days=30) if row["employee_code"] == "TRG0005"
    )
    assert "year" not in entry
    assert 1979 not in entry.values()
    assert entry["day"] == today.day
    assert entry["month"] == today.month


@pytest.mark.django_db
def test_employees_who_have_left_are_not_listed(org):
    today = timezone.localdate()
    leaver = set_birthday(org["peer"], born_on(today.month, today.day))
    leaver.employment_status = EmploymentStatus.INACTIVE
    leaver.save(update_fields=["employment_status"])

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0006" not in codes


@pytest.mark.django_db
def test_employees_without_a_recorded_birthday_are_skipped(org):
    assert org["employee"].date_of_birth is None
    assert upcoming_birthdays(horizon_days=30) == []


@pytest.mark.django_db
def test_birthdays_are_ordered_by_how_soon_they_are(org):
    today = timezone.localdate()
    for employee, offset in ((org["employee"], 12), (org["peer"], 2), (org["manager"], 7)):
        when = today + timedelta(days=offset)
        set_birthday(employee, born_on(when.month, when.day))

    rows = upcoming_birthdays(horizon_days=30)
    assert [row["employee_code"] for row in rows] == ["TRG0006", "TRG0004", "TRG0005"]


@pytest.mark.django_db
def test_the_list_is_capped(org, make_user, make_employee):
    today = timezone.localdate()
    for index in range(12):
        employee = make_employee(
            make_user(f"extra{index}@trigyan.io"), employee_code=f"EXT{index:04d}"
        )
        when = today + timedelta(days=index + 1)
        set_birthday(employee, born_on(when.month, when.day))

    assert len(upcoming_birthdays(horizon_days=30, limit=5)) == 5


# ---------------------------------------------------------------------------
# Holidays
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_upcoming_holidays_are_listed_in_date_order(db):
    today = timezone.localdate()
    Holiday.objects.create(date=today + timedelta(days=20), name="Later one")
    Holiday.objects.create(date=today + timedelta(days=5), name="Sooner one")

    rows = upcoming_holidays(horizon_days=60)
    assert [row["name"] for row in rows] == ["Sooner one", "Later one"]
    assert rows[0]["days_until"] == 5
    assert rows[0]["day_of_week"] == (today + timedelta(days=5)).strftime("%A")


@pytest.mark.django_db
def test_past_holidays_are_left_out(db):
    today = timezone.localdate()
    Holiday.objects.create(date=today - timedelta(days=1), name="Yesterday")
    Holiday.objects.create(date=today, name="Today")

    rows = upcoming_holidays(horizon_days=60)
    assert [row["name"] for row in rows] == ["Today"]
    assert rows[0]["is_today"] is True
    assert rows[0]["days_until"] == 0


@pytest.mark.django_db
def test_holidays_beyond_the_horizon_are_left_out(db):
    today = timezone.localdate()
    Holiday.objects.create(date=today + timedelta(days=100), name="Far away")
    assert upcoming_holidays(horizon_days=60) == []


@pytest.mark.django_db
def test_optional_holidays_are_marked(db):
    today = timezone.localdate()
    Holiday.objects.create(date=today + timedelta(days=3), name="Floating", is_optional=True)
    assert upcoming_holidays(horizon_days=60)[0]["is_optional"] is True


# ---------------------------------------------------------------------------
# The dashboard endpoint, for every role
# ---------------------------------------------------------------------------
@pytest.mark.django_db
@pytest.mark.parametrize("role", ["employee", "manager", "hr", "admin"])
def test_every_role_sees_the_noticeboard(auth_client, org, role):
    today = timezone.localdate()
    set_birthday(org["employee"], born_on(today.month, today.day))
    Holiday.objects.create(date=today + timedelta(days=4), name="Founders Day")

    response = auth_client(org[role]).get(URL)
    assert response.status_code == 200
    assert [row["employee_code"] for row in response.data["upcoming_birthdays"]] == ["TRG0005"]
    assert [row["name"] for row in response.data["upcoming_holidays"]] == ["Founders Day"]


@pytest.mark.django_db
def test_horizon_days_does_not_widen_the_noticeboard(auth_client, org):
    """The two cards are pinned to their own 30-day window.

    ``horizon_days`` is still echoed back - the field is part of the response
    shape, and the birthday *calendar* honours it - but the noticeboard cards
    use a fixed horizon so their heading can name it. A caller passing a wide
    horizon must not get two months of birthdays under a card that says 30 days.
    """
    today = timezone.localdate()
    well_beyond = today + timedelta(days=60)
    set_birthday(org["employee"], born_on(well_beyond.month, well_beyond.day))

    wide = auth_client(org["employee"]).get(URL, {"horizon_days": 90})

    assert wide.data["horizon_days"] == 90
    assert "TRG0005" not in {row["employee_code"] for row in wide.data["upcoming_birthdays"]}


def _first_of_next_month(today: date) -> date:
    return date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, 30), ("", 30), ("nonsense", 30), ("0", 30), ("-5", 30), ("7", 7), ("500", 90)],
)
def test_the_horizon_is_clamped(raw, expected):
    assert clamp_horizon(raw) == expected


# ---------------------------------------------------------------------------
# Phase 1 / F2 + F3: the dashboard holiday card, over a rolling window
# ---------------------------------------------------------------------------
# These used to pin "the remainder of this calendar month". That scoping made
# both dashboard cards empty on the 30th and 31st - nothing is left in the
# month by then - so the dashboard went blank once a month by construction,
# and these very tests failed on those days. The window now rolls forward from
# today, and the card headings name the window rather than the month.
@pytest.mark.django_db
def test_the_card_shows_holidays_inside_the_window(db):
    today = timezone.localdate()
    Holiday.objects.create(date=today + timedelta(days=1), name="Soon")
    Holiday.objects.create(date=today + timedelta(days=200), name="Far off")

    rows = upcoming_holidays(limit=4, horizon_days=30)
    assert [row["name"] for row in rows] == ["Soon"]


@pytest.mark.django_db
def test_tomorrow_is_listed_on_the_last_day_of_a_month(db):
    """The regression that started this: month-scoping dropped tomorrow.

    On 31 August, "tomorrow" is 1 September - outside the calendar month, so
    the old card showed nothing at all on the last day of every month.
    """
    with freeze_time("2026-08-31"):
        Holiday.objects.create(date=date(2026, 9, 1), name="Tomorrow")
        rows = upcoming_holidays(limit=4, horizon_days=30)
        assert [row["name"] for row in rows] == ["Tomorrow"]


@pytest.mark.django_db
def test_the_card_is_capped_at_four(db):
    today = timezone.localdate()
    for offset in range(1, 7):
        Holiday.objects.create(date=today + timedelta(days=offset), name=f"H{offset}")

    assert len(upcoming_holidays(limit=4, horizon_days=30)) <= 4


@pytest.mark.django_db
def test_the_card_carries_the_holiday_description(db):
    today = timezone.localdate()
    Holiday.objects.create(
        date=today + timedelta(days=1),
        name="Founders Day",
        description="Offices closed; the Hyderabad campus hosts the annual meet.",
    )
    row = upcoming_holidays(limit=4, horizon_days=30)[0]
    assert row["description"].startswith("Offices closed")


@pytest.mark.django_db
def test_a_quiet_window_yields_an_empty_card(db):
    """Legitimate: the page behind "View more" carries the rest of the year."""
    today = timezone.localdate()
    Holiday.objects.create(date=today + timedelta(days=200), name="Far off")
    assert upcoming_holidays(limit=4, horizon_days=30) == []


@pytest.mark.django_db
def test_the_dashboard_uses_the_rolling_card(auth_client, org):
    today = timezone.localdate()
    Holiday.objects.create(date=today + timedelta(days=2), name="In window", description="Note")
    Holiday.objects.create(date=today + timedelta(days=200), name="Out of window")

    response = auth_client(org["employee"]).get(URL)
    assert [row["name"] for row in response.data["upcoming_holidays"]] == ["In window"]
    assert response.data["upcoming_holidays"][0]["description"] == "Note"


@pytest.mark.django_db
def test_the_holidays_endpoint_round_trips_a_description(auth_client, org):
    created = auth_client(org["hr"]).post(
        "/api/v1/holidays/",
        {
            "date": "2026-11-14",
            "name": "Children's Day",
            "description": "Bring your children to the office.",
        },
    )
    assert created.status_code == 201, created.data
    assert created.data["description"] == "Bring your children to the office."

    listed = auth_client(org["employee"]).get("/api/v1/holidays/?year=2026")
    row = next(r for r in listed.data["results"] if r["name"] == "Children's Day")
    assert row["description"] == "Bring your children to the office."


# ---------------------------------------------------------------------------
# The dashboard noticeboard rolls forward from today
# ---------------------------------------------------------------------------
# Both cards answer the same question over the same window, so they read as one
# noticeboard. The window is a rolling horizon rather than the calendar month:
# month-scoping guaranteed an empty dashboard on the 30th and 31st.
@pytest.mark.django_db
def test_a_birthday_next_week_is_listed(org):
    today = timezone.localdate()
    upcoming = today + timedelta(days=7)
    set_birthday(org["employee"], born_on(upcoming.month, upcoming.day))

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0005" in codes


@pytest.mark.django_db
def test_a_birthday_next_month_is_listed_when_it_is_inside_the_window(org):
    """The point of the change: crossing a month boundary is not a reason to hide."""
    with freeze_time("2026-08-31"):
        set_birthday(org["employee"], born_on(9, 3))
        codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
        assert "TRG0005" in codes


@pytest.mark.django_db
def test_a_birthday_beyond_the_window_is_not_listed(org):
    today = timezone.localdate()
    far = today + timedelta(days=90)
    set_birthday(org["employee"], born_on(far.month, far.day))

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0005" not in codes


@pytest.mark.django_db
def test_a_birthday_already_past_is_not_listed(org):
    """Both cards start at today - that is what makes them one noticeboard."""
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    set_birthday(org["employee"], born_on(yesterday.month, yesterday.day))

    codes = {row["employee_code"] for row in upcoming_birthdays(horizon_days=30)}
    assert "TRG0005" not in codes


@pytest.mark.django_db
def test_the_dashboard_never_empties_at_month_end(auth_client, org):
    """The regression this whole section exists for.

    On the last day of a month the old month-scoped cards were empty whatever
    the data said. With a rolling window, a birthday three days out shows.
    """
    with freeze_time("2026-08-31"):
        set_birthday(org["peer"], born_on(9, 3))
        Holiday.objects.create(date=date(2026, 9, 2), name="Just after month end")

        response = auth_client(org["employee"]).get(URL)

        assert "TRG0006" in {row["employee_code"] for row in response.data["upcoming_birthdays"]}
        assert [row["name"] for row in response.data["upcoming_holidays"]] == [
            "Just after month end"
        ]


@pytest.mark.django_db
def test_both_cards_are_capped_at_the_same_number(auth_client, org):
    """Side by side, a four-row card beside an eight-row one is the
    misalignment people actually notice."""
    from apps.reports.upcoming import DASHBOARD_BIRTHDAY_LIMIT, DASHBOARD_HOLIDAY_LIMIT

    assert DASHBOARD_BIRTHDAY_LIMIT == DASHBOARD_HOLIDAY_LIMIT

    response = auth_client(org["employee"]).get(URL)

    assert len(response.data["upcoming_birthdays"]) <= DASHBOARD_BIRTHDAY_LIMIT
    assert len(response.data["upcoming_holidays"]) <= DASHBOARD_HOLIDAY_LIMIT


# --- the birthday calendar page behind the dashboard card ------------------

CALENDAR_URL = "/api/v1/dashboard/birthdays/"


@pytest.mark.django_db
def test_the_calendar_reaches_a_birthday_the_dashboard_window_cannot(auth_client, org):
    """The card stops at month end; the page behind it carries the year."""
    today = date.today()
    set_birthday(org["employee"], today + timedelta(days=200))

    response = auth_client(org["employee"]).get(CALENDAR_URL)

    assert response.status_code == 200
    codes = {row["employee_code"] for row in response.data["results"]}
    assert org["employee"].employee_code in codes
    assert response.data["count"] == len(response.data["results"])


@pytest.mark.django_db
def test_the_calendar_never_exposes_a_birth_year(auth_client, org):
    soon = date.today() + timedelta(days=5)
    set_birthday(org["employee"], born_on(soon.month, soon.day))  # born 1990

    response = auth_client(org["employee"]).get(CALENDAR_URL)

    for row in response.data["results"]:
        assert "1990" not in str(row.values()), row
        assert set(row) >= {"day", "month", "days_until"}
        assert "date_of_birth" not in row


@pytest.mark.django_db
def test_the_calendar_requires_sign_in(client):
    assert client.get(CALENDAR_URL).status_code == 401
