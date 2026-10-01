"""The copy helpers behind notification text.

What is pinned: dates render the way the frontend renders them, rupees carry
Indian digit grouping (lakhs, not thousands), and day counts never say
"5.0 day(s)". A regression here re-opens the "database talking to employees"
wording the helpers exist to close out.
"""

from datetime import date
from decimal import Decimal

from common.humanize import days_phrase, human_date, human_range, inr


def test_dates_read_like_the_frontend():
    assert human_date(date(2026, 6, 3)) == "3 Jun 2026"
    assert human_date(date(2027, 12, 25)) == "25 Dec 2027"


def test_a_same_year_range_names_the_year_once():
    assert human_range(date(2026, 8, 3), date(2026, 8, 7)) == "3 Aug → 7 Aug 2026"


def test_a_cross_year_range_names_both_years():
    assert human_range(date(2026, 12, 28), date(2027, 1, 2)) == "28 Dec 2026 → 2 Jan 2027"


def test_day_counts_never_say_day_s():
    assert days_phrase(Decimal("5.0")) == "5 days"
    assert days_phrase(Decimal("1.0")) == "1 day"
    assert days_phrase(Decimal("0.5")) == "0.5 days"
    assert days_phrase(Decimal("2.50")) == "2.5 days"
    assert days_phrase(5) == "5 days"


def test_rupees_group_the_indian_way():
    assert inr(Decimal("33340.00")) == "₹33,340.00"
    assert inr(Decimal("104836.00")) == "₹1,04,836.00"
    assert inr(Decimal("12345678.90")) == "₹1,23,45,678.90"
    assert inr(Decimal("999.5")) == "₹999.50"
    assert inr(0) == "₹0.00"


def test_negative_amounts_keep_the_sign_outside_the_symbol():
    assert inr(Decimal("-1500")) == "-₹1,500.00"
