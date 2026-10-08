"""Postal addresses entered field by field - country, PIN code, house, street,
landmark, town/city, state - the way Indian address forms ask for them.

The parts are kept (``*_address_detail``) so the address can be edited again
field by field, and the one-line text built from them is stored too
(``*_address``): that is the address of record, and what every profile card,
report and export already shows.

The frontend mirrors these rules (utils/address.ts). Keep the two in step.
"""

import re

import phonenumbers
from phonenumbers import geocoder
from rest_framework import serializers

INDIA = "IN"

#: The 28 states and 8 union territories, as India Post spells them.
INDIAN_STATES = (
    "Andaman and Nicobar Islands",
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chandigarh",
    "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jammu and Kashmir",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Ladakh",
    "Lakshadweep",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Puducherry",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
)

#: Six digits, never starting with 0 - India Post's PIN code.
INDIAN_PIN = re.compile(r"^[1-9]\d{5}$")
#: Elsewhere: letters, digits, spaces and dashes - "SW1A 1AA", "10001", "K1A 0B1".
POSTAL_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$")
#: A town is letters - in any script - with spaces, dots, dashes, apostrophes.
CITY = re.compile(r"^[^\W\d_]+(?:[ .'-]+[^\W\d_]+)*\.?$")


def country_name(code: str) -> str:
    """'IN' -> 'India'. phonenumbers already carries every region's name."""
    example = phonenumbers.example_number(code)
    return (geocoder.country_name_for_number(example, "en") if example else "") or code


class AddressSerializer(serializers.Serializer):
    country = serializers.CharField(max_length=2, default=INDIA)
    pincode = serializers.CharField(max_length=10, allow_blank=True, default="")
    line1 = serializers.CharField(max_length=120, label="Flat, house no., building, apartment")
    line2 = serializers.CharField(max_length=120, label="Area, street, sector, village")
    landmark = serializers.CharField(max_length=120, allow_blank=True, default="")
    city = serializers.CharField(max_length=60, label="Town/City")
    state = serializers.CharField(max_length=60, allow_blank=True, default="")

    def to_representation(self, instance) -> dict:
        # Stored parts may be empty (an address typed before this existed) or
        # partial (a draft) - read back whatever is there.
        if not instance:
            return {}
        return {name: instance.get(name, "") for name in self.fields}

    def validate_country(self, value: str) -> str:
        value = value.upper()
        if value not in phonenumbers.SUPPORTED_REGIONS:
            raise serializers.ValidationError("Choose a country from the list.")
        return value

    def validate_city(self, value: str) -> str:
        value = " ".join(value.split())
        if not CITY.match(value):
            raise serializers.ValidationError("Enter the town or city name in letters.")
        return value

    def validate(self, attrs: dict) -> dict:
        country = attrs.get("country", INDIA)
        pincode = attrs.get("pincode", "").strip()
        state = attrs.get("state", "").strip()
        errors = {}

        if country == INDIA:
            if not INDIAN_PIN.match(pincode):
                errors["pincode"] = "Enter a 6-digit PIN code (it cannot start with 0)."
            if state not in INDIAN_STATES:
                errors["state"] = "Choose a state from the list."
        elif pincode and not POSTAL_CODE.match(pincode):
            errors["pincode"] = "Enter a valid postal code."

        # Partial saves (a draft) leave out what has not been typed yet; only
        # what is there has to be right.
        if self.root.partial:
            errors = {k: v for k, v in errors.items() if attrs.get(k)}
        if errors:
            raise serializers.ValidationError(errors)

        attrs["pincode"] = pincode.upper()
        attrs["state"] = state
        for key in ("line1", "line2", "landmark"):
            if key in attrs:
                attrs[key] = " ".join(attrs[key].split())
        return attrs


def format_address(detail: dict) -> str:
    """The one-line address of record.

    "Flat 4B, Sunrise Apartments, Koramangala 5th Block, Near Forum Mall,
    Bengaluru, Karnataka 560095, India"
    """
    state_pin = " ".join(p for p in (detail.get("state", ""), detail.get("pincode", "")) if p)
    parts = [
        detail.get("line1", ""),
        detail.get("line2", ""),
        detail.get("landmark", ""),
        detail.get("city", ""),
        state_pin,
        country_name(detail["country"]) if detail.get("country") else "",
    ]
    return ", ".join(p for p in parts if p)


class StructuredAddressMixin(serializers.Serializer):
    """Accepts ``permanent_address_detail`` / ``current_address_detail`` and
    keeps the matching text field in step with them.

    A text address sent on its own (an older screen, or HR's form) is still
    accepted, and clears the parts - they would no longer describe it.
    """

    permanent_address_detail = AddressSerializer(required=False)
    current_address_detail = AddressSerializer(required=False)

    ADDRESS_KINDS = ("permanent", "current")

    def validate(self, attrs: dict) -> dict:
        for kind in self.ADDRESS_KINDS:
            detail = attrs.get(f"{kind}_address_detail")
            if detail is not None:
                attrs[f"{kind}_address"] = format_address(detail)
            elif f"{kind}_address" in attrs:
                attrs[f"{kind}_address_detail"] = {}
        return super().validate(attrs)
