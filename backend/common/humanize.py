"""Copy helpers for text shown to people - notification messages and emails.

Dates and money render here the way the frontend renders them ("3 Jun 2026",
"3 Aug → 7 Aug 2026", "₹35,748.00"), so a notification reads as part of the
same product as the page it links to. Before these helpers, messages carried
whatever ``str()`` produced - "2026-08-03 to 2026-08-07 (5.0 day(s))",
"Net pay: 33340.00" - which is the database talking, not the portal.
"""

from datetime import date
from decimal import Decimal

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def human_date(value: date) -> str:
    """``3 Jun 2026`` - the shape every date takes in the frontend."""
    return f"{value.day} {_MONTHS[value.month - 1]} {value.year}"


def human_date_short(value: date) -> str:
    """``3 Jun`` - for the left side of a same-year range."""
    return f"{value.day} {_MONTHS[value.month - 1]}"


def human_range(start: date, end: date) -> str:
    """``3 Aug → 7 Aug 2026`` - mirrors the frontend's ``formatDateRange``.

    The year appears once when both ends share it, twice when they straddle
    New Year, exactly as the pages render the same pair.
    """
    left = human_date_short(start) if start.year == end.year else human_date(start)
    return f"{left} → {human_date(end)}"


def days_phrase(days) -> str:
    """``5 days`` / ``1 day`` / ``0.5 days`` - never ``5.0 day(s)``."""
    value = Decimal(str(days))
    # int() for whole values: normalize() turns 50.0 into 5E+1, not 50.
    text = str(int(value)) if value == value.to_integral_value() else str(value.normalize())
    unit = "day" if value == 1 else "days"
    return f"{text} {unit}"


def inr(amount) -> str:
    """``₹1,04,836.00`` - rupees with Indian digit grouping.

    Indian grouping puts the first comma three digits from the right and every
    later one two digits further: lakhs and crores, not thousands and millions.
    """
    value = Decimal(str(amount)).quantize(Decimal("0.01"))
    sign = "-" if value < 0 else ""
    magnitude = abs(value)
    digits = str(int(magnitude))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    cents = f"{magnitude % 1:.2f}"[2:]
    return f"{sign}₹{digits}.{cents}"
