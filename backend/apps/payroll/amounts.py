"""Rupee amounts written out in words, for the payslip.

Indian numbering, not international: after a thousand the groups are lakh and
crore, so 1,25,000 reads "one lakh twenty five thousand" rather than "one
hundred twenty five thousand". Getting this wrong on a payslip is the kind of
mistake people notice immediately.
"""

from decimal import Decimal

UNITS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
]

TENS = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
]

#: (divisor, name), largest first. Indian grouping: crore, lakh, thousand.
SCALES = [(10_000_000, "crore"), (100_000, "lakh"), (1_000, "thousand")]


def _under_hundred(value: int) -> str:
    if value < 20:
        return UNITS[value]
    tens, unit = divmod(value, 10)
    return TENS[tens] + (f" {UNITS[unit]}" if unit else "")


def _under_thousand(value: int) -> str:
    hundreds, rest = divmod(value, 100)
    parts = []
    if hundreds:
        parts.append(f"{UNITS[hundreds]} hundred")
    if rest:
        parts.append(_under_hundred(rest))
    return " ".join(parts)


def number_to_words(value: int) -> str:
    """Writes a whole number out, using the Indian scale names."""
    if value < 0:
        return f"minus {number_to_words(-value)}"
    if value == 0:
        return UNITS[0]

    parts = []
    remaining = value
    for divisor, name in SCALES:
        group, remaining = divmod(remaining, divisor)
        if group:
            parts.append(f"{number_to_words(group)} {name}")
    if remaining:
        parts.append(_under_thousand(remaining))
    return " ".join(parts)


def rupees_in_words(amount: Decimal) -> str:
    """ "Rupees Forty Two Thousand Five Hundred and Fifty Paise Only".

    Paise are named only when there are any - a payslip for a round figure
    should not read "and zero paise".
    """
    quantised = Decimal(amount).quantize(Decimal("0.01"))
    whole = int(quantised)
    paise = int((quantised - whole) * 100)

    words = f"Rupees {number_to_words(whole)}"
    if paise:
        words += f" and {number_to_words(paise)} paise"
    return f"{words} only".title().replace(" And ", " and ")
