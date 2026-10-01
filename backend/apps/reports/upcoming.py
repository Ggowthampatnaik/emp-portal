"""Upcoming birthdays and holidays for the dashboard.

Both are company-wide: everyone sees the same list whatever their role, the way
a noticeboard works.

Birthdays deliberately expose the day and month only - never the year. Age is
personal data with no bearing on wishing someone a happy birthday, and the
dashboard is visible to the whole company.
"""

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
#: How far the two dashboard cards look ahead. Both use it, so they always
#: cover the same stretch of calendar.
NOTICEBOARD_HORIZON_DAYS = 30


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _window(today: date, horizon_days: int) -> dict[tuple[int, int], int]:
    """Maps each (month, day) in the window to how many days away it is.

    Built by walking real dates, so the year boundary needs no special case:
    31 December simply rolls into 1 January.
    """
    days: dict[tuple[int, int], int] = {}
    for offset in range(horizon_days + 1):
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
