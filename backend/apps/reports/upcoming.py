"""Upcoming birthdays, work anniversaries and holidays for the dashboard.

Both are company-wide: everyone sees the same list whatever their role, the way
a noticeboard works.

Birthdays deliberately expose the day and month only - never the year. Age is
personal data with no bearing on wishing someone a happy birthday, and the
dashboard is visible to the whole company.
"""

import calendar
from datetime import date, timedelta
from functools import reduce
from operator import or_

from django.db.models import Q
from django.db.models.functions import ExtractDay, ExtractMonth
from django.utils import timezone

from apps.employees.models import Employee
from apps.leave_management.models import Holiday
from common.enums import EmploymentStatus
from common.media import media_url

DEFAULT_HORIZON_DAYS = 30
MAX_HORIZON_DAYS = 90
DEFAULT_LIMIT = 8
# The two dashboard noticeboard cards show at most this many each. Same number
# for both, because they sit side by side and a four-row card next to an
# eight-row one is the misalignment people actually notice.
DASHBOARD_HOLIDAY_LIMIT = 4
DASHBOARD_BIRTHDAY_LIMIT = 4
#: Rows on the dashboard's anniversary card; a quiet month is topped up to it.
DASHBOARD_ANNIVERSARY_ROWS = 2
#: How far the two dashboard cards look ahead. Both use it, so they always
#: cover the same stretch of calendar.
NOTICEBOARD_HORIZON_DAYS = 30


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _window(today: date, horizon_days: int, days_back: int = 0) -> dict[tuple[int, int], int]:
    """Maps each (month, day) in the window to how many days away it is.

    Built by walking real dates, so the year boundary needs no special case:
    31 December simply rolls into 1 January. ``days_back`` starts the window
    that many days before today; those days map to negative offsets.
    """
    days: dict[tuple[int, int], int] = {}
    for offset in range(-days_back, horizon_days + 1):
        moment = today + timedelta(days=offset)
        days.setdefault((moment.month, moment.day), offset)

        # Someone born on 29 February has no birthday in a common year; treat
        # 28 February as the day it falls on, rather than skipping them.
        if moment.month == 2 and moment.day == 28 and not _is_leap(moment.year):
            days.setdefault((2, 29), offset)
    return days


def _photo_url(employee: Employee, request) -> str | None:
    if not employee.photo:
        return None
    return media_url(request, employee.photo)


def upcoming_birthdays(
    request=None,
    horizon_days: int = DEFAULT_HORIZON_DAYS,
    limit: int = DEFAULT_LIMIT,
) -> list[dict]:
    """Active employees with a birthday coming up.

    The window rolls forward ``horizon_days`` from today. It used to stop at
    the end of the calendar month so the card could be headed "Birthdays in
    August" - but that emptied the card on the 30th and 31st, when there is by
    definition nothing left in the month. The heading now names the window
    instead of the month, so the two agree on every day of the year.
    """
    today = timezone.localdate()
    window = _window(today, horizon_days)
    if not window:
        return []

    matches = reduce(or_, (Q(bmonth=month, bday=day) for month, day in window))
    employees = (
        Employee.objects.filter(
            employment_status=EmploymentStatus.ACTIVE, date_of_birth__isnull=False
        )
        .annotate(bmonth=ExtractMonth("date_of_birth"), bday=ExtractDay("date_of_birth"))
        .filter(matches)
        .select_related("user", "department", "designation")
    )

    rows = []
    for employee in employees:
        born = employee.date_of_birth
        days_until = window.get((born.month, born.day))
        if days_until is None:
            continue

        celebrated_on = today + timedelta(days=days_until)
        rows.append(
            {
                "id": employee.pk,
                "employee_code": employee.employee_code,
                "full_name": employee.full_name,
                "department_name": employee.department.name if employee.department_id else None,
                "designation_name": (
                    employee.designation.name if employee.designation_id else None
                ),
                "photo_url": _photo_url(employee, request),
                # Day and month only - the birth year is never sent.
                "day": born.day,
                "month": born.month,
                "celebrated_on": celebrated_on,
                "days_until": days_until,
                "is_today": days_until == 0,
            }
        )

    rows.sort(key=lambda row: (row["days_until"], row["full_name"]))
    return rows[:limit]


def upcoming_anniversaries(
    request=None,
    horizon_days: int = DEFAULT_HORIZON_DAYS,
    limit: int = DEFAULT_LIMIT,
    include_month_so_far: bool = False,
) -> list[dict]:
    """Active employees whose work anniversary is coming up.

    The anniversary is the day and month of ``date_of_joining``; ``years`` is
    how many years they complete on it. Someone who joined less than a year
    ago has no anniversary yet and is left out - "0 years" is not a milestone.
    The same rolling window as birthdays, so the cards agree on every day.

    With ``include_month_so_far`` the window also reaches back to the 1st of
    the current month, so an anniversary earlier this month stays on the
    dashboard all month instead of vanishing the day after (``days_until`` is
    negative for those). Rows stay in calendar order.
    """
    today = timezone.localdate()
    days_back = today.day - 1 if include_month_so_far else 0
    window = _window(today, horizon_days, days_back)
    if not window:
        return []

    matches = reduce(or_, (Q(jmonth=month, jday=day) for month, day in window))
    employees = (
        Employee.objects.filter(
            employment_status=EmploymentStatus.ACTIVE, date_of_joining__isnull=False
        )
        .annotate(jmonth=ExtractMonth("date_of_joining"), jday=ExtractDay("date_of_joining"))
        .filter(matches)
        .select_related("user", "department", "designation")
    )

    rows = []
    for employee in employees:
        joined = employee.date_of_joining
        days_until = window.get((joined.month, joined.day))
        if days_until is None:
            continue

        celebrated_on = today + timedelta(days=days_until)
        years = celebrated_on.year - joined.year
        if years < 1:
            continue
        rows.append(
            {
                "id": employee.pk,
                "employee_code": employee.employee_code,
                "full_name": employee.full_name,
                "department_name": employee.department.name if employee.department_id else None,
                "designation_name": (
                    employee.designation.name if employee.designation_id else None
                ),
                "photo_url": _photo_url(employee, request),
                "date_of_joining": joined,
                "years": years,
                "day": joined.day,
                "month": joined.month,
                "celebrated_on": celebrated_on,
                "days_until": days_until,
                "is_today": days_until == 0,
                "this_month": (celebrated_on.year, celebrated_on.month)
                == (today.year, today.month),
            }
        )

    rows.sort(key=lambda row: (row["days_until"], row["full_name"]))
    return rows[:limit]


def anniversaries_this_month(request=None, at_least: int = 0) -> list[dict]:
    """Every work anniversary in the current calendar month, 1st to last day.

    The dashboard card shows the first couple and counts the rest, so it needs
    the whole month rather than a capped list. A quiet month - fewer than
    ``at_least`` - is topped up with the next anniversaries after it, so the
    card never sits half empty; those rows carry a later ``celebrated_on``,
    which is how the card tells them apart from this month's.
    """
    today = timezone.localdate()
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    everyone = Employee.objects.count() + 1
    rows = upcoming_anniversaries(
        request,
        horizon_days=days_in_month - today.day,
        limit=everyone,
        include_month_so_far=True,
    )
    if len(rows) < at_least:
        month_end = today.replace(day=days_in_month)
        later = [
            row
            for row in upcoming_anniversaries(request, horizon_days=365, limit=everyone)
            if row["celebrated_on"] > month_end
        ]
        rows += later[: at_least - len(rows)]
    return rows


def _holiday_row(holiday: Holiday, today: date) -> dict:
    return {
        "id": holiday.pk,
        "date": holiday.date,
        "name": holiday.name,
        "description": holiday.description,
        "is_optional": holiday.is_optional,
        "day_of_week": holiday.date.strftime("%A"),
        "days_until": (holiday.date - today).days,
        "is_today": holiday.date == today,
    }


def upcoming_holidays(
    horizon_days: int = DEFAULT_HORIZON_DAYS * 2,
    limit: int = DEFAULT_LIMIT,
) -> list[dict]:
    """Company holidays still to come, within a rolling window from today.

    Previously the dashboard asked for the remainder of the calendar month,
    which made the card empty by construction at month end. It now shares the
    birthday card's rolling horizon; the page behind "View More" still carries
    the whole year.
    """
    today = timezone.localdate()
    holidays = Holiday.objects.filter(
        date__gte=today, date__lte=today + timedelta(days=horizon_days)
    )
    return [_holiday_row(holiday, today) for holiday in holidays.order_by("date")[:limit]]


def clamp_horizon(raw: str | None, default: int = DEFAULT_HORIZON_DAYS) -> int:
    """Keeps a caller-supplied horizon sane.

    Anything missing, non-numeric or not a positive number falls back to the
    default; a window of zero or negative days is a mistake, not a request for
    an empty list.
    """
    if not raw or not raw.lstrip("-").isdigit():
        return default
    value = int(raw)
    if value <= 0:
        return default
    return min(MAX_HORIZON_DAYS, value)
