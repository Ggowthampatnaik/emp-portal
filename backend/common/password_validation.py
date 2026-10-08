"""The portal's password rule: upper case, lower case, a number and a symbol.

Length is Django's MinimumLengthValidator (8); this adds the four character
classes. It runs wherever a password is chosen - the change-password page, and
an administrator creating an account or issuing a temporary password - because
all of them go through `validate_password`.

The frontend shows the same rules as a live checklist (utils/passwordRules.ts).
Keep the two in step.
"""

from django.core.exceptions import ValidationError

#: (test, what is missing) - in the order the checklist shows them.
RULES = (
    (str.isupper, "an uppercase letter (A-Z)"),
    (str.islower, "a lowercase letter (a-z)"),
    (str.isdigit, "a number (0-9)"),
    (lambda c: not c.isalnum() and not c.isspace(), "a special character (e.g. @ # $ % & !)"),
)


class CharacterClassValidator:
    """Requires at least one character from each class in RULES."""

    def validate(self, password: str, user=None) -> None:
        missing = [label for test, label in RULES if not any(test(c) for c in password)]
        if missing:
            raise ValidationError(
                "The password must contain at least %(missing)s.",
                code="password_missing_character_class",
                params={"missing": _join(missing)},
            )

    def get_help_text(self) -> str:
        return (
            "Your password must contain an uppercase letter, a lowercase letter, "
            "a number and a special character."
        )


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]
