"""Addresses entered field by field, the Indian way, and the line built from them."""

import pytest

from common.address import AddressSerializer, format_address

HOME = {
    "country": "IN",
    "pincode": "560095",
    "line1": "Flat 4B, Sunrise Apartments",
    "line2": "Koramangala 5th Block",
    "landmark": "Near Forum Mall",
    "city": "Bengaluru",
    "state": "Karnataka",
}


def check(**changes):
    serializer = AddressSerializer(data={**HOME, **changes})
    return serializer.is_valid(), serializer.errors


def test_a_complete_indian_address_is_accepted_and_reads_as_one_line():
    serializer = AddressSerializer(data=HOME)
    assert serializer.is_valid(), serializer.errors
    assert format_address(serializer.validated_data) == (
        "Flat 4B, Sunrise Apartments, Koramangala 5th Block, Near Forum Mall, "
        "Bengaluru, Karnataka 560095, India"
    )


def test_the_landmark_is_optional():
    ok, errors = check(landmark="")
    assert ok, errors


@pytest.mark.parametrize("pincode", ["", "56009", "5600955", "060095", "56o095"])
def test_an_indian_pin_code_is_six_digits_not_starting_with_zero(pincode):
    ok, errors = check(pincode=pincode)
    assert not ok
    assert "6-digit PIN code" in str(errors["pincode"])


def test_an_indian_state_must_come_from_the_list():
    ok, errors = check(state="Karnatak")
    assert not ok and "state" in errors
    ok, errors = check(state="")
    assert not ok and "state" in errors


@pytest.mark.parametrize("field", ["line1", "line2", "city"])
def test_house_street_and_city_are_required(field):
    ok, errors = check(**{field: ""})
    assert not ok and field in errors


def test_a_city_is_letters():
    ok, errors = check(city="560095")
    assert not ok and "city" in errors
    ok, errors = check(city="Navi Mumbai")
    assert ok, errors


def test_another_country_takes_its_own_postal_code_and_any_region():
    ok, errors = check(country="GB", pincode="SW1A 1AA", state="Greater London", city="London")
    assert ok, errors
    serializer = AddressSerializer(
        data={**HOME, "country": "GB", "pincode": "sw1a 1aa", "state": "", "city": "London"}
    )
    assert serializer.is_valid(), serializer.errors
    assert format_address(serializer.validated_data).endswith("London, SW1A 1AA, United Kingdom")


def test_an_unknown_country_is_refused():
    ok, errors = check(country="ZZ")
    assert not ok and "country" in errors
