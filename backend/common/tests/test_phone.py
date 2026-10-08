"""Phone numbers are validated per country and stored as E.164."""

import pytest
from rest_framework import serializers

from common.phone import normalise_phone


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("9876543210", "+919876543210"),  # no country code: read as Indian
        ("+91 98765 43210", "+919876543210"),
        ("098765-43210", "+919876543210"),  # trunk prefix 0
        ("+1 415 555 2671", "+14155552671"),  # US: mobile and landline look alike
        ("+44 7400 123456", "+447400123456"),  # UK mobile
        ("+971 50 123 4567", "+971501234567"),  # UAE mobile
        ("+65 8123 4567", "+6581234567"),  # Singapore mobile
    ],
)
def test_valid_mobiles_are_stored_in_one_format(typed, stored):
    assert normalise_phone(typed, mobile=True) == stored


@pytest.mark.parametrize(
    ("typed", "message"),
    [
        ("12345", "10-digit Indian mobile"),
        ("5876543210", "10-digit Indian mobile"),  # Indian mobiles start 6-9
        ("98765432101", "10-digit Indian mobile"),  # 11 digits
        ("+44 7400 12", "not a valid number for +44"),
        ("not a number", "valid phone number"),
    ],
)
def test_invalid_numbers_say_why(typed, message):
    with pytest.raises(serializers.ValidationError) as refused:
        normalise_phone(typed, mobile=True)
    assert message in str(refused.value.detail[0])


def test_a_landline_is_not_accepted_as_the_employees_mobile():
    with pytest.raises(serializers.ValidationError, match="mobile number, not a landline"):
        normalise_phone("+44 20 7946 0958", mobile=True)  # London landline
    with pytest.raises(serializers.ValidationError, match="10-digit Indian mobile"):
        normalise_phone("+91 80 2345 6789", mobile=True)  # Bengaluru landline


def test_a_landline_is_fine_for_an_emergency_contact():
    assert normalise_phone("+91 80 2345 6789", mobile=False) == "+918023456789"
