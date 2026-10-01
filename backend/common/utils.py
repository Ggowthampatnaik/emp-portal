"""Small helpers used across apps."""

from datetime import date, timedelta
from decimal import Decimal


def daterange(start: date, end: date):
    """Yields every date from ``start`` to ``end`` inclusive."""
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def working_days(start: date, end: date, holidays: set[date] | None = None) -> int:
    """Counts Mon-Fri days between two dates, skipping the given holidays.

    Used by leave-day calculation and timesheet completeness checks.
    """
    holidays = holidays or set()
    return sum(1 for day in daterange(start, end) if day.weekday() < 5 and day not in holidays)


def to_decimal(value, places: str = "0.01") -> Decimal:
    """Normalises user-supplied hours/day counts to a fixed scale."""
    return Decimal(str(value)).quantize(Decimal(places))


def week_bounds(any_day: date) -> tuple[date, date]:
    """Returns the Monday and Sunday of the week containing ``any_day``."""
    monday = any_day - timedelta(days=any_day.weekday())
    return monday, monday + timedelta(days=6)


def payload_with(request, **extra) -> dict:
    """``request.data`` as a plain dict, plus whatever the view wants to add.

    Not ``{**request.data, ...}``. For a multipart request ``request.data`` is a
    ``QueryDict``, which stores a *list* behind every key; because it subclasses
    ``dict``, ``**`` unpacking takes the concrete-dict fast path and hands back
    those lists instead of the values. An uploaded file arrived as ``[file]``
    and the serializer rejected it as "not a file" - silently, and only ever for
    multipart, which is why it survived so long. Reading key by key goes through
    ``__getitem__``, which is the method that returns the value itself.
    """
    payload = {key: request.data[key] for key in request.data}
    payload.update(extra)
    return payload
