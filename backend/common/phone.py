"""Phone numbers: validated per country and stored in one format.

Every number is stored as E.164 - "+919876543210" - whatever was typed, so a
number entered as "098765 43210" and one entered as "+91 98765-43210" are the
same value, and the country is never ambiguous. A number typed without a
country code is read as Indian, which is what every form before the country
picker sent.

The rules are Google's libphonenumber (the `phonenumbers` package): length and
number ranges for every country, kept up to date by the package. The browser
uses the JavaScript port (libphonenumber-js) so the two agree.
"""

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat, PhoneNumberType
from rest_framework import serializers

DEFAULT_REGION = "IN"

#: A US or Canadian number cannot be told apart from a landline, so "either"
#: has to count as a mobile.
MOBILE_TYPES = {PhoneNumberType.MOBILE, PhoneNumberType.FIXED_LINE_OR_MOBILE}


def normalise_phone(value: str, *, mobile: bool) -> str:
    """Returns the number as E.164, or raises ValidationError saying why not."""
    try:
        number = phonenumbers.parse(value, DEFAULT_REGION)
    except NumberParseException as exc:
        raise serializers.ValidationError("Enter a valid phone number.") from exc

    indian = number.country_code == 91
    valid = phonenumbers.is_valid_number(number)
    # In India a 10-digit number not starting 6-9 is a landline with its STD
    # code, so "not a landline" would only confuse - say what a mobile is.
    if indian and (not valid or (mobile and phonenumbers.number_type(number) not in MOBILE_TYPES)):
        raise serializers.ValidationError(
            "Enter a valid 10-digit Indian mobile number, starting with 6, 7, 8 or 9."
            if mobile
            else "Enter a valid Indian phone number."
        )
    if not valid:
        raise serializers.ValidationError(
            f"This is not a valid number for +{number.country_code}. "
            "Check the country code and the number."
        )
    if mobile and phonenumbers.number_type(number) not in MOBILE_TYPES:
        raise serializers.ValidationError("Enter a mobile number, not a landline.")

    return phonenumbers.format_number(number, PhoneNumberFormat.E164)


class PhoneNumberField(serializers.CharField):
    """A CharField that validates per country and stores E.164.

    ``mobile=True`` refuses landlines (the employee's own number);
    ``mobile=False`` takes any valid number (an emergency contact may well be
    a home phone).
    """

    def __init__(self, *, mobile: bool = True, **kwargs):
        self.mobile = mobile
        kwargs.setdefault("max_length", 20)
        super().__init__(**kwargs)

    def to_internal_value(self, data) -> str:
        value = super().to_internal_value(data)
        if not value:
            return value
        return normalise_phone(value, mobile=self.mobile)
