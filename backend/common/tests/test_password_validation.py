"""The password rule: 8+ characters with upper case, lower case, a number and a symbol."""

import pytest
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

from apps.authentication.reset import generate_temporary_password


@pytest.mark.parametrize("password", ["Portal@123", "Tr1gyan#2026", "aB3$efgh", "Ünïcode9!x"])
def test_a_password_with_every_class_is_accepted(password):
    validate_password(password)


@pytest.mark.parametrize(
    ("password", "missing"),
    [
        ("portal@123", "uppercase"),
        ("PORTAL@123", "lowercase"),
        ("Portal@abc", "number"),
        ("Portal1234", "special character"),
        ("Pa@1", "at least 8 characters"),
    ],
)
def test_each_missing_rule_is_named(password, missing):
    with pytest.raises(ValidationError) as refused:
        validate_password(password)
    assert missing in " ".join(refused.value.messages)


def test_everything_missing_is_named_in_one_message():
    with pytest.raises(ValidationError) as refused:
        validate_password("qwertyzxcvbn")
    message = " ".join(refused.value.messages)
    for part in ("uppercase", "number", "special character"):
        assert part in message


def test_a_space_is_not_a_special_character():
    with pytest.raises(ValidationError):
        validate_password("Portal 123")


def test_generated_temporary_passwords_always_pass():
    for _ in range(500):
        validate_password(generate_temporary_password())
